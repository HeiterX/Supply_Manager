import { createHash, randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import type { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

const MAX_BYTES = 8 * 1024 * 1024;
const directory = () => join(process.cwd(), 'uploads', 'offer-documents');

function identifyFile(file: Express.Multer.File): { ext: string; mime: string } {
  if (!file?.buffer || file.size < 8 || file.size > MAX_BYTES) {
    throw new BadRequestException('Документ КП должен иметь размер от 8 байт до 8 МБ');
  }
  const data = file.buffer;
  let ext = '';
  let mime = '';
  if (data.subarray(0, 5).toString('ascii') === '%PDF-' &&
      data.subarray(Math.max(0, data.length - 2048)).toString('latin1').includes('%%EOF')) {
    ext = '.pdf'; mime = 'application/pdf';
  } else if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
             data.subarray(12, 16).toString('ascii') === 'IHDR') {
    ext = '.png'; mime = 'image/png';
  } else if (data[0] === 255 && data[1] === 216 && data[2] === 255 &&
             data[data.length - 2] === 255 && data[data.length - 1] === 217) {
    ext = '.jpg'; mime = 'image/jpeg';
  } else {
    throw new BadRequestException('Допускаются только PDF, PNG и JPEG с подтверждённой сигнатурой');
  }
  const original = basename(file.originalname.replace(/\\/g, '/'));
  if (original.length > 255 || !new RegExp(ext === '.jpg' ? '\\.(jpg|jpeg)$' : `\\${ext}$`, 'i').test(original)) {
    throw new BadRequestException('Расширение файла не соответствует содержимому');
  }
  if (file.mimetype !== mime && file.mimetype !== 'application/octet-stream') {
    throw new BadRequestException('Заявленный MIME-тип не соответствует файлу');
  }
  return { ext, mime };
}

@Injectable()
export class OfferDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(taskId: string, offerId: string, actorId: string, file: Express.Multer.File) {
    const kind = identifyFile(file);
    const offer = await this.prisma.supplierOffer.findFirst({
      where: { id: offerId, taskId },
      select: { id: true, version: true, task: { select: { status: true } } },
    });
    if (!offer) throw new NotFoundException('КП не найдено');
    if (['CLOSED', 'CANCELLED'].includes(offer.task.status)) {
      throw new ConflictException('Нельзя прикреплять файлы к закрытой закупке');
    }
    const storageName = randomUUID() + kind.ext;
    const name = basename(file.originalname.replace(/\\/g, '/'))
      .replace(/[\x00-\x1F\x7F]/g, '_');
    const folder = directory();
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(join(folder, storageName), file.buffer, { flag: 'wx', mode: 0o600 });
    try {
      return await this.prisma.$transaction(async tx => {
        const current = await tx.supplierOffer.findFirst({
          where: { id: offerId, taskId },
          select: { version: true, task: { select: { status: true } } },
        });
        if (!current || ['CLOSED', 'CANCELLED'].includes(current.task.status)) {
          throw new ConflictException('КП или закупка изменились');
        }
        const document = await tx.supplierOfferDocument.create({
          data: {
            offerId, version: current.version, originalName: name,
            storageName, mimeType: kind.mime, size: file.size,
            sha256: createHash('sha256').update(file.buffer).digest('hex'),
            uploadedById: actorId,
          },
        });
        await tx.supplierOfferRevision.create({
          data: {
            offerId, version: current.version, actorId,
            action: 'DOCUMENT_UPLOADED',
            snapshot: {
              documentId: document.id, originalName: name,
              sha256: document.sha256, version: current.version,
            },
          },
        });
        await tx.taskActivity.create({
          data: { taskId, text: `К КП прикреплён документ «${name}» (версия ${current.version})` },
        });
        return document;
      });
    } catch (error) {
      await unlink(join(folder, storageName)).catch(() => undefined);
      throw error;
    }
  }

  async download(taskId: string, offerId: string, documentId: string) {
    const document = await this.prisma.supplierOfferDocument.findFirst({
      where: { id: documentId, offerId, offer: { taskId } },
    });
    if (!document) throw new NotFoundException('Документ КП не найден');
    if (!/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(document.storageName)) {
      throw new BadRequestException('Некорректная ссылка на файл');
    }
    return { ...document, path: join(directory(), document.storageName) };
  }
}
