import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  access,
  mkdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import type {
  CreatePublicPurchaseRequestDto,
  CreatePurchaseRequestDto,
} from './dto/create-purchase-request.dto.js';

const PHOTO_DIRECTORY = join(
  process.cwd(),
  'uploads',
  'purchase-requests',
);

const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const MAX_PHOTO_SIZE = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SAFE_PHOTO_NAME = /^[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|png|webp)$/i;

const userSelect = {
  id: true,
  fullName: true,
  username: true,
  email: true,
  phone: true,
  department: true,
  position: true,
  role: true,
  status: true,
} as const;

const requestInclude = {
  requester: { select: userSelect },
  processedBy: { select: userSelect },
  items: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { createdAt: 'asc' as const },
    ],
  },
  task: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
    },
  },
};

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
  ) {}

  /*
   * Существующее создание заявки зарегистрированным пользователем.
   */
  async create(user: AuthUser, dto: CreatePurchaseRequestDto) {
    const requiredAt = dto.requiredAt
      ? new Date(dto.requiredAt)
      : null;

    return this.prisma.purchaseRequest.create({
      data: {
        requesterId: user.id,
        title: dto.title.trim(),
        description: this.optionalText(dto.description),
        priority: dto.priority ?? 'NORMAL',
        requiredAt,
        notes: this.optionalText(dto.notes),
        items: {
          create: dto.items.map((item, index) => ({
            name: item.name.trim(),
            partNumber: this.optionalText(item.partNumber),
            quantity: item.quantity,
            unit: item.unit.trim(),
            notes: this.optionalText(item.notes),
            sortOrder: index,
          })),
        },
      },
      include: requestInclude,
    });
  }

  /*
   * Простая заявка работника без регистрации.
   */
  async createPublic(dto: CreatePublicPurchaseRequestDto) {
    const firstItem = dto.items[0];

    const purchaseRequest =
      await this.prisma.purchaseRequest.create({
        data: {
          requesterName: dto.requesterName.trim(),

          /*
           * title нужен существующей внутренней модели.
           * Для простой формы автоматически используем
           * название первой позиции.
           */
          title: firstItem.name.trim(),

          priority: 'NORMAL',
          status: 'NEW',

          items: {
            create: dto.items.map((item, index) => ({
              name: item.name.trim(),
              quantity: item.quantity,
              unit: item.unit.trim(),
              notes: this.optionalText(item.description),
              sortOrder: index,
            })),
          },
        },
        include: requestInclude,
      });

    /*
     * Telegram — только дополнительный канал уведомления.
     * Ошибка Telegram не должна отменять уже созданную заявку.
     */
    try {
      await this.telegramService.sendNewPurchaseRequest(
        purchaseRequest,
      );
    } catch (error) {
      console.error(
        `Не удалось отправить Telegram-уведомление о заявке №${purchaseRequest.number}:`,
        error,
      );
    }

    return {
      ...purchaseRequest,
      // The capability is returned only once, never saved on the request.
      uploadToken: this.createPublicUploadToken(purchaseRequest.id),
    };
  }


  /*
   * The public form returns a short-lived signed upload capability.
   * Knowing a request/item UUID alone is not sufficient to upload.
   */
  private createPublicUploadToken(requestId: string): string {
    const expiresAt = Math.floor(Date.now() / 1000) + UPLOAD_TOKEN_TTL_SECONDS;
    const payload = requestId + '.' + expiresAt;
    return payload + '.' + this.signPublicUploadPayload(payload);
  }

  private signPublicUploadPayload(payload: string): string {
    // Domain separation prevents interpreting a JWT as an upload capability.
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must contain at least 32 characters');
    }

    return createHmac('sha256', secret)
      .update('supply-manager:public-photo-upload:v1:' + payload)
      .digest('hex');
  }

  private assertPublicUploadToken(requestId: string, token?: string): void {
    if (!token || token.length > 200) {
      throw new UnauthorizedException('Требуется токен загрузки фотографии');
    }

    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      parts[0] !== requestId ||
      !/^\d{10}$/.test(parts[1]) ||
      !/^[0-9a-f]{64}$/.test(parts[2])
    ) {
      throw new UnauthorizedException('Недействительный токен загрузки');
    }

    const payload = parts[0] + '.' + parts[1];
    const expected = Buffer.from(this.signPublicUploadPayload(payload), 'hex');
    const signature = Buffer.from(parts[2], 'hex');

    if (!timingSafeEqual(expected, signature)) {
      throw new UnauthorizedException('Недействительный токен загрузки');
    }

    if (Number(parts[1]) <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Срок действия токена загрузки истёк');
    }
  }

  private detectImageType(buffer: Buffer): {
    mimeType: string;
    extension: string;
  } | null {
    if (
      buffer.length >= 45 &&
      buffer.subarray(0, 8).equals(PNG_SIGNATURE) &&
      buffer.readUInt32BE(8) === 13 &&
      buffer.toString('ascii', 12, 16) === 'IHDR' &&
      buffer.readUInt32BE(buffer.length - 12) === 0 &&
      buffer.toString('ascii', buffer.length - 8, buffer.length - 4) === 'IEND'
    ) {
      return { mimeType: 'image/png', extension: '.png' };
    }

    if (
      buffer.length >= 4 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff &&
      buffer[buffer.length - 2] === 0xff &&
      buffer[buffer.length - 1] === 0xd9
    ) {
      return { mimeType: 'image/jpeg', extension: '.jpg' };
    }

    if (
      buffer.length >= 20 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP' &&
      buffer.readUInt32LE(4) + 8 === buffer.length &&
      /^(VP8 |VP8L|VP8X)$/.test(buffer.toString('ascii', 12, 16))
    ) {
      return { mimeType: 'image/webp', extension: '.webp' };
    }

    return null;
  }

  async attachPublicItemPhoto(
    requestId: string,
    itemId: string,
    photo: Express.Multer.File,
    uploadToken?: string,
  ) {
    this.assertPublicUploadToken(requestId, uploadToken);

    const item = await this.prisma.purchaseRequestItem.findFirst({
      where: { id: itemId, requestId },
      select: {
        photoPath: true,
        request: {
          select: { status: true, taskId: true, requesterId: true },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Позиция заявки не найдена');
    }

    // Only unprocessed requests created by the public form can use this route.
    if (
      item.request.status !== 'NEW' ||
      item.request.taskId !== null ||
      item.request.requesterId !== null
    ) {
      throw new ForbiddenException('Заявка больше не принимает фотографии');
    }

    if (item.photoPath !== null) {
      throw new ConflictException('Фотография уже загружена');
    }

    const buffer = photo?.buffer;
    if (!buffer || buffer.length === 0 || buffer.length > MAX_PHOTO_SIZE) {
      throw new BadRequestException('Недопустимый размер фотографии');
    }

    const detected = this.detectImageType(buffer);
    if (!detected || detected.mimeType !== photo.mimetype) {
      throw new BadRequestException(
        'Содержимое файла не соответствует допустимому изображению JPG, PNG или WebP',
      );
    }

    const filename = itemId + '-' + randomUUID() + detected.extension;
    await mkdir(PHOTO_DIRECTORY, { recursive: true });
    const absolutePath = join(PHOTO_DIRECTORY, filename);
    await writeFile(absolutePath, buffer, { flag: 'wx' });

    try {
      // Atomic conditional write prevents races/replays, and checks status
      // again in case procurement accepted the request during upload.
      const result = await this.prisma.purchaseRequestItem.updateMany({
        where: {
          id: itemId,
          requestId,
          photoPath: null,
          request: {
            is: {
              status: 'NEW',
              taskId: null,
              requesterId: null,
            },
          },
        },
        data: {
          photoPath: filename,
          photoOriginalName: basename(photo.originalname.replace(/\\/g, '/')).slice(0, 255),
          photoMimeType: detected.mimeType,
        },
      });

      if (result.count !== 1) {
        throw new ConflictException(
          'Фотография уже добавлена или заявка принята в работу',
        );
      }
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }

    return {
      id: itemId,
      photoUrl: '/api/v1/purchase-requests/public/items/' + itemId + '/photo',
    };
  }

  async getPublicItemPhoto(user: AuthUser, itemId: string) {
    const item = await this.prisma.purchaseRequestItem.findUnique({
      where: { id: itemId },
      select: {
        photoPath: true,
        photoMimeType: true,
        request: { select: { requesterId: true } },
      },
    });

    if (!item) {
      throw new NotFoundException('Фотография не найдена');
    }

    const canSeeAll = user.role === 'PROCUREMENT' || user.role === 'ADMIN';
    if (!canSeeAll && (!item.request.requesterId || item.request.requesterId !== user.id)) {
      throw new ForbiddenException('Нет доступа к фотографии этой заявки');
    }

    if (!item.photoPath || !SAFE_PHOTO_NAME.test(item.photoPath)) {
      throw new NotFoundException('Фотография не найдена');
    }

    // The filename must be from the server-generated allowlist; never use
    // an arbitrary file path from the database for sendFile.
    const absolutePath = join(PHOTO_DIRECTORY, item.photoPath);
    try {
      await access(absolutePath);
    } catch {
      throw new NotFoundException('Файл фотографии не найден');
    }

    return {
      absolutePath,
      mimeType: item.photoMimeType ?? 'application/octet-stream',
    };
  }

  async accept(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const purchaseRequest = await tx.purchaseRequest.findUnique({
        where: { id },
        include: {
          requester: {
            select: {
              fullName: true,
            },
          },
          items: {
            orderBy: [
              { sortOrder: 'asc' },
              { createdAt: 'asc' },
            ],
          },
        },
      });

      if (!purchaseRequest) {
        throw new NotFoundException('Заявка не найдена');
      }

      /*
       * Повторное нажатие не должно создавать вторую закупку.
       */
      if (purchaseRequest.taskId) {
        return tx.purchaseRequest.findUnique({
          where: { id },
          include: requestInclude,
        });
      }

      if (
        purchaseRequest.status === 'REJECTED' ||
        purchaseRequest.status === 'CANCELLED'
      ) {
        throw new ConflictException(
          'Эту заявку нельзя принять в работу',
        );
      }

      const requesterName =
        purchaseRequest.requesterName?.trim() ||
        purchaseRequest.requester?.fullName ||
        'Не указан';

      const taskDescription = [
        purchaseRequest.description?.trim(),
        `Исходная заявка №${purchaseRequest.number}`,
        `Заявитель: ${requesterName}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const task = await tx.task.create({
        data: {
          title: purchaseRequest.title,
          description: taskDescription,
          priority: purchaseRequest.priority,
          deadline: purchaseRequest.requiredAt,
          nextAction: 'Начать поиск поставщиков',

          items: {
            create: purchaseRequest.items.map((item) => ({
              name: item.name,
              partNumber: item.partNumber,
              quantity: item.quantity,
              unit: item.unit,
              notes: item.notes,
              sortOrder: item.sortOrder,
            })),
          },

          activities: {
            create: {
              text:
                `Закупка создана из заявки №${purchaseRequest.number}. ` +
                `Заявитель: ${requesterName}`,
            },
          },
        },
      });

      return tx.purchaseRequest.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          taskId: task.id,
          processedById: user.id,
          processedAt: new Date(),
        },
        include: requestInclude,
      });
    });
  }

  async findMine(user: AuthUser) {
    return this.prisma.purchaseRequest.findMany({
      where: {
        requesterId: user.id,
      },
      include: requestInclude,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findAll() {
    return this.prisma.purchaseRequest.findMany({
      include: requestInclude,
      orderBy: [
        { status: 'asc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async findOne(user: AuthUser, id: string) {
    const purchaseRequest =
      await this.prisma.purchaseRequest.findUnique({
        where: {
          id,
        },
        include: requestInclude,
      });

    if (!purchaseRequest) {
      throw new NotFoundException(
        'Заявка не найдена',
      );
    }

    const canSeeAll =
      user.role === 'PROCUREMENT' ||
      user.role === 'ADMIN';

    if (
      !canSeeAll &&
      purchaseRequest.requesterId !== user.id
    ) {
      throw new ForbiddenException(
        'Нет доступа к этой заявке',
      );
    }

    return purchaseRequest;
  }

  private optionalText(value?: string) {
    const normalized = value?.trim();

    return normalized
      ? normalized
      : null;
  }
}
