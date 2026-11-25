import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto.js';

export type TechnicalParameters = Record<string, string>;

export function normalizeCatalogText(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('ru-RU');
}

export function validateTechnicalParameters(
  value: Record<string, string> | undefined,
): TechnicalParameters {
  if (value === undefined) return {};
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new BadRequestException('Характеристики должны быть объектом');
  }
  const entries = Object.entries(value);
  if (entries.length > 30) {
    throw new BadRequestException('Допускается не более 30 технических характеристик');
  }
  const normalized: TechnicalParameters = {};
  for (const [key, v] of entries) {
    const trimmedKey = key.trim();
    if (
      !trimmedKey || trimmedKey.length > 80 ||
      ['__proto__', 'constructor', 'prototype'].includes(trimmedKey)
    ) {
      throw new BadRequestException('Некорректное название характеристики');
    }
    if (typeof v !== 'string' || !v.trim() || v.length > 500) {
      throw new BadRequestException('Значения характеристик должны быть строками от 1 до 500 символов');
    }
    if (Object.keys(normalized).some((k) => normalizeCatalogText(k) === normalizeCatalogText(trimmedKey))) {
      throw new BadRequestException('Повторяющаяся характеристика');
    }
    normalized[trimmedKey] = v.trim();
  }
  return Object.fromEntries(
    Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b, 'ru')),
  );
}

export function catalogFingerprint(input: {
  name: string;
  partNumber?: string | null;
  unit: string;
  category: string;
  attributes: TechnicalParameters;
}): string {
  const specs = Object.entries(input.attributes)
    .map(([key, value]) => [
      normalizeCatalogText(key),
      normalizeCatalogText(value),
    ] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const identity = input.partNumber?.trim()
    ? ['part', normalizeCatalogText(input.partNumber)]
    : ['name', normalizeCatalogText(input.name)];
  return createHash('sha256')
    .update(JSON.stringify([
      normalizeCatalogText(input.category),
      ...identity,
      normalizeCatalogText(input.unit),
      specs,
    ]))
    .digest('hex');
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query?: string) {
    const term = query?.trim().slice(0, 100);
    return this.prisma.catalogItem.findMany({
      where: {
        active: true,
        ...(term ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { partNumber: { contains: term, mode: 'insensitive' as const } },
            { category: { contains: term, mode: 'insensitive' as const } },
          ],
        } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: 50,
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item || !item.active) {
      throw new NotFoundException('Карточка номенклатуры не найдена');
    }
    return item;
  }

  async create(dto: CreateCatalogItemDto) {
    const name = dto.name.trim();
    const unit = dto.unit.trim();
    const partNumber = dto.partNumber?.trim() || null;
    const category = dto.category?.trim() || 'Без категории';
    if (!name || !unit) {
      throw new BadRequestException('Наименование и единица обязательны');
    }
    const attributes = validateTechnicalParameters(dto.attributes);
    const fingerprint = catalogFingerprint({
      name, partNumber, unit, category, attributes,
    });
    const existing = await this.prisma.catalogItem.findUnique({
      where: { fingerprint },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Такая номенклатура уже существует; используйте имеющуюся карточку',
        existingId: existing.id,
      });
    }
    try {
      return await this.prisma.catalogItem.create({
        data: {
          name,
          normalizedName: normalizeCatalogText(name),
          partNumber,
          normalizedPartNumber: partNumber ? normalizeCatalogText(partNumber) : null,
          category,
          unit,
          attributes,
          fingerprint,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Такая номенклатура уже существует');
      }
      throw error;
    }
  }
}
