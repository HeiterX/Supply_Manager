import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SaveSupplierDto } from './dto/save-supplier.dto.js';

export function normalizeSupplierName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('ru-RU');
}

const supplierSnapshot = (item: {
  id: string; name: string; taxId: string | null;
  legalAddress: string | null; bankDetails: string | null;
  contact: string | null; phone: string | null; email: string | null;
  website: string | null; categories: string[];
  status: string; responsibleId: string | null; notes: string | null;
}): Prisma.InputJsonValue => ({
  id: item.id, name: item.name, taxId: item.taxId,
  legalAddress: item.legalAddress, bankDetails: item.bankDetails,
  contact: item.contact, phone: item.phone, email: item.email,
  website: item.website, categories: item.categories,
  status: item.status, responsibleId: item.responsibleId,
  notes: item.notes,
} as Prisma.InputJsonValue);

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q?: string) {
    const term = q?.trim().slice(0, 120);
    return this.prisma.supplier.findMany({
      where: term ? {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { taxId: { contains: term } },
          { contact: { contains: term, mode: 'insensitive' } },
          { categories: { has: term } },
        ],
      } : {},
      include: {
        _count: { select: { offers: true, purchaseOrders: true } },
      },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
  }

  async one(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        responsible: { select: { id: true, fullName: true } },
        history: { orderBy: { createdAt: 'desc' }, take: 100 },
        offers: {
          select: {
            id: true, taskId: true, status: true, version: true, currency: true,
            price: true, deliveryDays: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        purchaseOrders: {
          select: {
            id: true, taskId: true, supplierOfferId: true,
            status: true, invoiceNumber: true, totalPrice: true, orderedAt: true,
          },
          orderBy: { orderedAt: 'desc' },
          take: 100,
        },
      },
    });
    if (!supplier) throw new NotFoundException('Поставщик не найден');
    return supplier;
  }

  private async validateResponsible(tx: Prisma.TransactionClient, id?: string) {
    if (!id) return;
    const user = await tx.user.findUnique({ where: { id }, select: { status: true, role: true } });
    if (!user || user.status !== 'ACTIVE' || !['ADMIN', 'PROCUREMENT'].includes(user.role)) {
      throw new BadRequestException('Ответственный должен быть активным снабженцем или администратором');
    }
  }

  private categories(dto: SaveSupplierDto): string[] {
    const categories = (dto.categories ?? []).map(s => s.trim()).filter(Boolean);
    if (categories.some(s => s.length > 100)) throw new BadRequestException('Категория слишком длинная');
    if (new Set(categories.map(s => normalizeSupplierName(s))).size !== categories.length) {
      throw new BadRequestException('Категории не должны повторяться');
    }
    return categories;
  }

  private async findDuplicate(tx: Prisma.TransactionClient, name: string, taxId?: string, excludeId?: string) {
    const normalized = normalizeSupplierName(name);
    const matches = await tx.supplier.findMany({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [
          { normalizedName: normalized },
          { name: { contains: name.trim(), mode: 'insensitive' } },
          ...(taxId ? [{ taxId }] : []),
        ],
      },
      select: { id: true, name: true, taxId: true },
      take: 150,
    });
    return matches.find(s => normalizeSupplierName(s.name) === normalized || Boolean(taxId && s.taxId === taxId));
  }

  async create(dto: SaveSupplierDto, actorId: string) {
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException('Укажите наименование поставщика');
    try {
      return await this.prisma.$transaction(async tx => {
        await this.validateResponsible(tx, dto.responsibleId);
        const existing = await this.findDuplicate(tx, name, dto.taxId);
        if (existing) throw new ConflictException({
          message: 'Поставщик уже существует, используйте карточку из справочника',
          existingId: existing.id,
        });
        const item = await tx.supplier.create({
          data: {
            name, normalizedName: normalizeSupplierName(name),
            taxId: dto.taxId ?? null,
            legalAddress: dto.legalAddress?.trim() || null,
            bankDetails: dto.bankDetails?.trim() || null,
            contact: dto.contact?.trim() || null, phone: dto.phone?.trim() || null,
            email: dto.email?.trim() || null, website: dto.website?.trim() || null,
            categories: this.categories(dto), status: dto.status ?? 'ACTIVE',
            responsibleId: dto.responsibleId ?? null, notes: dto.notes?.trim() || null,
          },
        });
        await tx.supplierChange.create({ data: {
          supplierId: item.id, actorId, action: 'CREATED', after: supplierSnapshot(item),
        } });
        return item;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Поставщик с такими реквизитами уже существует');
      }
      throw error;
    }
  }

  async update(id: string, dto: SaveSupplierDto, actorId: string) {
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException('Укажите наименование поставщика');
    try {
      return await this.prisma.$transaction(async tx => {
        const existing = await tx.supplier.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Поставщик не найден');
        const duplicate = await this.findDuplicate(tx, name, dto.taxId, id);
        if (duplicate) throw new ConflictException({
          message: 'Найдена другая карточка с таким наименованием или ИНН',
          existingId: duplicate.id,
        });
        await this.validateResponsible(tx, dto.responsibleId);
        const item = await tx.supplier.update({
          where: { id }, data: {
            name, normalizedName: normalizeSupplierName(name),
            taxId: dto.taxId ?? null, legalAddress: dto.legalAddress?.trim() || null,
            bankDetails: dto.bankDetails?.trim() || null,
            contact: dto.contact?.trim() || null, phone: dto.phone?.trim() || null,
            email: dto.email?.trim() || null, website: dto.website?.trim() || null,
            categories: this.categories(dto), status: dto.status ?? existing.status,
            responsibleId: dto.responsibleId ?? null, notes: dto.notes?.trim() || null,
          },
        });
        const before = supplierSnapshot(existing);
        const after = supplierSnapshot(item);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          await tx.supplierChange.create({ data: {
            supplierId: id, actorId, action: 'UPDATED', before, after,
          } });
        }
        return item;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Поставщик с такими реквизитами уже существует');
      }
      throw error;
    }
  }

  async resolveForOffer(
    tx: Prisma.TransactionClient,
    dto: { supplierId?: string; supplierName?: string; contact?: string; phone?: string; email?: string; website?: string },
    actorId?: string,
  ) {
    if (dto.supplierId) {
      const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) throw new NotFoundException('Поставщик из справочника не найден');
      if (supplier.status !== 'ACTIVE') throw new ConflictException('Поставщик заблокирован или приостановлен');
      if (dto.supplierName && normalizeSupplierName(dto.supplierName) !== normalizeSupplierName(supplier.name)) {
        throw new ConflictException('Поставщик и название справочника не совпадают');
      }
      return supplier;
    }
    const name = dto.supplierName?.trim();
    if (!name || name.length < 2) throw new BadRequestException('Выберите поставщика');
    const existing = await this.findDuplicate(tx, name);
    if (existing) {
      const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: existing.id } });
      if (supplier.status !== 'ACTIVE') throw new ConflictException('Поставщик заблокирован или приостановлен');
      return supplier;
    }
    try {
      const supplier = await tx.supplier.create({ data: {
        name, normalizedName: normalizeSupplierName(name),
        contact: dto.contact?.trim() || null,
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        website: dto.website?.trim() || null,
      } });
      await tx.supplierChange.create({ data: {
        supplierId: supplier.id, actorId: actorId ?? null,
        action: 'CREATED_FROM_OFFER', after: supplierSnapshot(supplier),
      } });
      return supplier;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const supplier = await tx.supplier.findFirst({
          where: { normalizedName: normalizeSupplierName(name) },
        });
        if (supplier) return supplier;
      }
      throw error;
    }
  }
}
