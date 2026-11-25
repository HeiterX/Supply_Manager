import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { CreateSupplierOfferDto } from './dto/create-supplier-offer.dto.js';

export function quotePrice(dto: CreateSupplierOfferDto): {
  currency: string | null;
  price: number | null;
} {
  const rows = dto.items ?? [];
  const explicitCurrencies = rows.map(row => row.currency).filter((v): v is string => Boolean(v));
  const unique = new Set(explicitCurrencies);
  if (unique.size > 1) {
    throw new BadRequestException('В одном КП нельзя смешивать разные валюты без конвертации');
  }
  if (dto.currency && unique.size && !unique.has(dto.currency)) {
    throw new BadRequestException('Валюта КП и строки должны совпадать');
  }
  const currency = dto.currency ?? (unique.size === 1 && explicitCurrencies.length === rows.length
    ? explicitCurrencies[0] : rows.length ? null : 'RUB');
  if (rows.length === 0) {
    // Historical legacy quotes used RUB and a single total.
    return { currency: dto.currency ?? (dto.price !== undefined ? 'RUB' : null), price: dto.price ?? null };
  }
  if (!currency || rows.some(row => row.unitPrice === undefined)) {
    return { currency, price: null };
  }
  const amount = rows.reduce((sum, row) => sum + row.quantity * (row.unitPrice ?? 0), 0);
  if (!Number.isFinite(amount) || amount > 999999999999) {
    throw new BadRequestException('Итог КП выходит за допустимые пределы');
  }
  return { currency, price: Math.round((amount + Number.EPSILON) * 100) / 100 };
}

export function offerSnapshot(offer: {
  id: string;
  supplierId: string;
  taskId: string;
  status: string;
  version: number;
  currency: string | null;
  price: { toString(): string } | null;
  deliveryPrice: { toString(): string } | null;
  deliveryDays: number | null;
  validUntil: Date | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  notes: string | null;
  items: Array<{
    id: string;
    taskItemId: string;
    quantity: { toString(): string };
    unitPrice: { toString(): string } | null;
    currency: string;
    inStock: boolean | null;
    notes: string | null;
  }>;
}): Prisma.InputJsonValue {
  return {
    id: offer.id, supplierId: offer.supplierId, taskId: offer.taskId,
    status: offer.status, version: offer.version, currency: offer.currency,
    price: offer.price?.toString() ?? null,
    deliveryPrice: offer.deliveryPrice?.toString() ?? null,
    deliveryDays: offer.deliveryDays,
    validUntil: offer.validUntil?.toISOString() ?? null,
    paymentTerms: offer.paymentTerms, deliveryTerms: offer.deliveryTerms,
    notes: offer.notes,
    items: offer.items.map(item => ({
      taskItemId: item.taskItemId,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice?.toString() ?? null,
      currency: item.currency,
      inStock: item.inStock,
      notes: item.notes,
    })),
  } as Prisma.InputJsonValue;
}
