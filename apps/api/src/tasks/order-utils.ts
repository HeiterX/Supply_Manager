import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import type { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';

type OrderWithItems = Prisma.PurchaseOrderGetPayload<{
  include: { items: true };
}>;

export function orderCreateFingerprint(
  supplierOfferId: string,
  dto: CreatePurchaseOrderDto,
): string {
  const rows = (dto.items ?? [])
    .map((row) => [row.supplierOfferItemId, Math.round(row.quantity * 1000)])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  const identity = {
    supplierOfferId,
    invoiceNumber: dto.invoiceNumber.trim(),
    invoiceDate: new Date(dto.invoiceDate).toISOString(),
    notes: dto.notes?.trim() ?? '',
    rows,
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function orderSnapshot(order: OrderWithItems): Prisma.InputJsonValue {
  return {
    id: order.id,
    taskId: order.taskId,
    supplierId: order.supplierId,
    supplierOfferId: order.supplierOfferId,
    version: order.version,
    status: order.status,
    invoiceNumber: order.invoiceNumber,
    invoiceDate: order.invoiceDate?.toISOString() ?? null,
    notes: order.notes,
    price: order.price?.toString() ?? null,
    deliveryPrice: order.deliveryPrice?.toString() ?? null,
    totalPrice: order.totalPrice?.toString() ?? null,
    sentToPaymentAt: order.sentToPaymentAt?.toISOString() ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    items: order.items.map((line) => ({
      id: line.id,
      taskItemId: line.taskItemId,
      supplierOfferItemId: line.supplierOfferItemId,
      name: line.name,
      partNumber: line.partNumber,
      quantity: line.quantity.toString(),
      unit: line.unit,
      unitPrice: line.unitPrice?.toString() ?? null,
      currency: line.currency,
      notes: line.notes,
    })),
  } as Prisma.InputJsonValue;
}
