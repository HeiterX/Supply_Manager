import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreatePublicPurchaseRequestDto,
  CreatePurchaseRequestDto,
} from './dto/create-purchase-request.dto.js';

const PHOTO_DIRECTORY = join(
  process.cwd(),
  'uploads',
  'purchase-requests',
);

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
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.purchaseRequest.create({
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
  }

  /*
   * Прикрепляет фотографию к конкретной позиции.
   */
  async attachPublicItemPhoto(
    requestId: string,
    itemId: string,
    photo: Express.Multer.File,
  ) {
    const item = await this.prisma.purchaseRequestItem.findFirst({
      where: {
        id: itemId,
        requestId,
      },
    });

    if (!item) {
      throw new NotFoundException(
        'Позиция заявки не найдена',
      );
    }

    const extensions: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };

    const extension = extensions[photo.mimetype] ?? '.jpg';

    await mkdir(PHOTO_DIRECTORY, {
      recursive: true,
    });

    const filename =
      `${item.id}-${randomUUID()}${extension}`;

    const absolutePath = join(
      PHOTO_DIRECTORY,
      filename,
    );

    await writeFile(absolutePath, photo.buffer);

    const previousPhotoPath = item.photoPath
      ? join(PHOTO_DIRECTORY, item.photoPath)
      : null;

    const updatedItem =
      await this.prisma.purchaseRequestItem.update({
        where: {
          id: item.id,
        },
        data: {
          photoPath: filename,
          photoOriginalName: photo.originalname,
          photoMimeType: photo.mimetype,
        },
      });

    if (previousPhotoPath) {
      await unlink(previousPhotoPath).catch(() => undefined);
    }

    return {
      ...updatedItem,
      photoUrl:
        `/api/v1/purchase-requests/public/items/${item.id}/photo`,
    };
  }

  async getPublicItemPhoto(itemId: string) {
    const item =
      await this.prisma.purchaseRequestItem.findUnique({
        where: {
          id: itemId,
        },
        select: {
          photoPath: true,
          photoMimeType: true,
        },
      });

    if (!item?.photoPath) {
      throw new NotFoundException(
        'Фотография не найдена',
      );
    }

    const absolutePath = join(
      PHOTO_DIRECTORY,
      item.photoPath,
    );

    try {
      await access(absolutePath);
    } catch {
      throw new NotFoundException(
        'Файл фотографии не найден',
      );
    }

    return {
      absolutePath,
      mimeType:
        item.photoMimeType ?? 'application/octet-stream',
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
