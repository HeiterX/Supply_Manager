import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import { CreateSupplierOfferDto } from './dto/create-supplier-offer.dto.js';
import { ShipPurchaseOrderDto } from './dto/ship-purchase-order.dto.js';
import { HandOverPurchaseOrderDto } from './dto/hand-over-purchase-order.dto.js';

const milli = (value: number) => Math.round(value * 1000);
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

@Injectable()
export class MultiOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // A row lock serializes all allocations for the same procurement task.
  private async lockTask(tx: Prisma.TransactionClient, taskId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: { items: true },
    });
    if (!task) throw new NotFoundException('Закупка не найдена');
    if (task.status === 'CLOSED' || task.status === 'CANCELLED') {
      throw new ConflictException('Закрытую или отменённую закупку нельзя изменять');
    }
    return task;
  }

  private async refreshTask(tx: Prisma.TransactionClient, taskId: string) {
    const [items, orders] = await Promise.all([
      tx.taskItem.findMany({ where: { taskId } }),
      tx.purchaseOrder.findMany({
        where: { taskId, cancelledAt: null },
        include: { items: true },
      }),
    ]);
    const allocated = new Map<string, number>();
    const handed = new Map<string, number>();
    for (const order of orders) {
      for (const line of order.items) {
        if (!line.taskItemId) continue;
        allocated.set(line.taskItemId, (allocated.get(line.taskItemId) ?? 0) + milli(line.quantity.toNumber()));
        if (order.status === 'HANDED_OVER') {
          handed.set(line.taskItemId, (handed.get(line.taskItemId) ?? 0) + milli(line.quantity.toNumber()));
        }
      }
    }
    const allAllocated = items.length > 0 && items.every(item =>
      (allocated.get(item.id) ?? 0) >= milli(item.quantity.toNumber()));
    const allHanded = items.length > 0 && items.every(item =>
      (handed.get(item.id) ?? 0) >= milli(item.quantity.toNumber()));
    const stages = [
      'ORDERED', 'WAITING_PAYMENT', 'WAITING_SHIPMENT', 'IN_TRANSIT',
      'READY_FOR_PICKUP', 'RECEIVED', 'HANDED_OVER',
    ];
    const earliest = orders.reduce((min, order) => Math.min(min, stages.indexOf(order.status)), 6);
    const status = !orders.length ? 'SEARCHING'
      : allHanded ? 'HANDED_OVER'
      : !allAllocated && earliest === 6 ? 'ORDERED'
      : stages[earliest];
    const nextAction = !orders.length ? 'Получить предложения и оформить заказы'
      : !allAllocated ? 'Распределить оставшиеся позиции между поставщиками'
      : allHanded ? 'Закрыть закупку'
      : 'Контролировать оплату и поставку по заказам';
    await tx.task.update({
      where: { id: taskId },
      data: { status: status as 'SEARCHING' | 'HANDED_OVER' | 'ORDERED' | 'WAITING_PAYMENT' | 'WAITING_SHIPMENT' | 'IN_TRANSIT' | 'READY_FOR_PICKUP' | 'RECEIVED', nextAction, reminderAt: null },
    });
  }

  async updateOffer(taskId: string, offerId: string, dto: CreateSupplierOfferDto) {
    if (!dto.supplierName?.trim() || !dto.items?.length) {
      throw new BadRequestException('Укажите поставщика и позиции КП');
    }
    const items = dto.items;
    if (new Set(items.map(item => item.taskItemId)).size !== items.length) {
      throw new BadRequestException('Позиции КП не должны повторяться');
    }
    return this.prisma.$transaction(async tx => {
      const task = await this.lockTask(tx, taskId);
      const offer = await tx.supplierOffer.findFirst({ where: { taskId, id: offerId } });
      if (!offer) throw new NotFoundException('КП не найдено');
      const orders = await tx.purchaseOrder.count({ where: { taskId, supplierOfferId: offerId } });
      if (orders) throw new ConflictException('КП уже использовалось в заказе. Для новых условий добавьте новое КП');
      const byId = new Map<string, (typeof task.items)[number]>(task.items.map(item => [item.id, item]));
      for (const item of items) {
        const taskItem = byId.get(item.taskItemId);
        if (!taskItem || milli(item.quantity) > milli(taskItem.quantity.toNumber())) {
          throw new BadRequestException('Позиция КП не относится к закупке или превышает требуемое количество');
        }
        if (item.currency && item.currency.trim().toUpperCase() !== 'RUB') {
          throw new BadRequestException('Сейчас поддерживаются КП в рублях');
        }
      }
      const hasPrices = items.every(item => item.unitPrice !== undefined);
      const price = hasPrices ? money(items.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0)) : null;
      await tx.supplier.update({ where: { id: offer.supplierId }, data: {
        name: dto.supplierName.trim(), contact: dto.contact?.trim() || null,
        phone: dto.phone?.trim() || null, email: dto.email?.trim() || null,
        website: dto.website?.trim() || null,
      } });
      const updated = await tx.supplierOffer.update({ where: { id: offerId }, data: {
        price, deliveryPrice: dto.deliveryPrice ?? null, deliveryDays: dto.deliveryDays ?? null,
        notes: dto.notes?.trim() || null, status: 'OFFER_RECEIVED',
        items: { deleteMany: {}, create: items.map(item => ({
          taskItemId: item.taskItemId, quantity: item.quantity, unitPrice: item.unitPrice,
          currency: 'RUB', inStock: item.inStock, notes: item.notes?.trim() || null,
        })) },
      }, include: { supplier: true, items: { include: { taskItem: true } } } });
      await tx.taskActivity.create({ data: { taskId, text: `Изменено предложение поставщика «${updated.supplier.name}»` } });
      return updated;
    }, { timeout: 15000 });
  }

  async createOrder(taskId: string, offerId: string, dto: CreatePurchaseOrderDto) {
    const requestedItems = dto.items;
    if (!requestedItems?.length) {
      throw new BadRequestException('Выберите хотя бы одну позицию для заказа');
    }
    if (!dto.invoiceNumber?.trim() || !dto.invoiceDate) {
      throw new BadRequestException('Укажите номер и дату счёта');
    }
    if (new Set(requestedItems.map(item => item.supplierOfferItemId)).size !== requestedItems.length) {
      throw new BadRequestException('Позиции заказа не должны повторяться');
    }
    return this.prisma.$transaction(async tx => {
      const task = await this.lockTask(tx, taskId);
      const offer = await tx.supplierOffer.findFirst({
        where: { id: offerId, taskId },
        include: { supplier: true, items: { include: { taskItem: true } } },
      });
      if (!offer) throw new NotFoundException('Предложение поставщика не найдено');
      if (!offer.items.length) throw new BadRequestException('У КП нет позиций. Создайте новое КП с позициями');
      const orders = await tx.purchaseOrder.findMany({
        where: { taskId, cancelledAt: null }, include: { items: true },
      });
      if (orders.some(order => order.items.length === 0)) {
        throw new ConflictException('В закупке есть заказ старого формата. Завершите его отдельно');
      }
      if (orders.some(order => order.supplierOfferId === offerId)) {
        throw new ConflictException('По этому КП уже оформлен действующий заказ');
      }
      const allocated = new Map<string, number>();
      for (const order of orders) for (const line of order.items) {
        if (!line.taskItemId) continue;
        allocated.set(line.taskItemId, (allocated.get(line.taskItemId) ?? 0) + milli(line.quantity.toNumber()));
      }
      const byId = new Map<string, (typeof offer.items)[number]>(offer.items.map(item => [item.id, item]));
      const lines = requestedItems.map(line => {
        const offerItem = byId.get(line.supplierOfferItemId);
        if (!offerItem) throw new BadRequestException('Позиция не относится к выбранному КП');
        const quantity = Number(line.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0 || milli(quantity) !== quantity * 1000) {
          throw new BadRequestException('Количество должно быть положительным, не более 3 знаков после запятой');
        }
        const requested = milli(quantity);
        const required = milli(offerItem.taskItem.quantity.toNumber());
        const remaining = required - (allocated.get(offerItem.taskItemId) ?? 0);
        if (requested > milli(offerItem.quantity.toNumber()) || requested > remaining) {
          throw new ConflictException(`«${offerItem.taskItem.name}»: доступно ${Math.max(0, remaining) / 1000} ${offerItem.taskItem.unit}, поставщик предложил ${offerItem.quantity} ${offerItem.taskItem.unit}`);
        }
        allocated.set(offerItem.taskItemId, (allocated.get(offerItem.taskItemId) ?? 0) + requested);
        if (offerItem.currency !== 'RUB') {
          throw new BadRequestException('Для оформления заказа сейчас поддерживаются цены в рублях');
        }
        return { offerItem, quantity };
      });
      const hasPrices = lines.every(line => line.offerItem.unitPrice !== null);
      const price = hasPrices ? money(lines.reduce((sum, line) => sum + line.quantity * line.offerItem.unitPrice!.toNumber(), 0)) : null;
      const deliveryPrice = offer.deliveryPrice;
      const totalPrice = price === null ? null : money(price + (deliveryPrice?.toNumber() ?? 0));
      const order = await tx.purchaseOrder.create({
        data: {
          taskId, supplierId: offer.supplierId, supplierOfferId: offer.id,
          status: 'ORDERED', invoiceNumber: dto.invoiceNumber.trim(), invoiceDate: new Date(dto.invoiceDate),
          notes: dto.notes?.trim() || null, price, deliveryPrice, totalPrice, deliveryDays: offer.deliveryDays,
          items: { create: lines.map(({ offerItem, quantity }) => ({
            taskItemId: offerItem.taskItemId, supplierOfferItemId: offerItem.id,
            name: offerItem.taskItem.name, partNumber: offerItem.taskItem.partNumber,
            quantity, unit: offerItem.taskItem.unit, unitPrice: offerItem.unitPrice,
            currency: offerItem.currency, notes: offerItem.notes,
          })) },
        },
        include: { items: true, supplier: true },
      });
      await tx.supplierOffer.update({ where: { id: offer.id }, data: { status: 'SELECTED' } });
      await tx.task.update({ where: { id: taskId }, data: {
        selectedOfferId: offer.id, currentPurchaseOrderId: order.id,
      } });
      await this.refreshTask(tx, taskId);
      await tx.taskActivity.create({ data: { taskId, text: `Оформлен заказ у «${offer.supplier.name}», счёт № ${order.invoiceNumber}, ${lines.length} поз.` } });
      return order;
    }, { timeout: 15000 });
  }

  async action(
    taskId: string, orderId: string, action: string,
    body: { reason?: string; handedOverTo?: string; shippedAt?: string; carrier?: string; trackingNumber?: string; expectedDeliveryAt?: string } = {},
  ) {
    const transitions: Record<string, [string, string]> = {
      'send-to-payment': ['ORDERED', 'WAITING_PAYMENT'],
      'confirm-payment': ['WAITING_PAYMENT', 'WAITING_SHIPMENT'],
      ship: ['WAITING_SHIPMENT', 'IN_TRANSIT'],
      'ready-for-pickup': ['IN_TRANSIT', 'READY_FOR_PICKUP'],
      receive: ['READY_FOR_PICKUP', 'RECEIVED'],
      'hand-over': ['RECEIVED', 'HANDED_OVER'],
    };
    if (!(action in transitions) && action !== 'cancel') {
      throw new BadRequestException('Неизвестное действие с заказом');
    }
    return this.prisma.$transaction(async tx => {
      await this.lockTask(tx, taskId);
      const order = await tx.purchaseOrder.findFirst({
        where: { id: orderId, taskId }, include: { supplier: true, items: true },
      });
      if (!order) throw new NotFoundException('Заказ не найден в этой закупке');
      if (!order.items.length) throw new ConflictException('Для старого заказа используйте прежний сценарий');
      if (order.cancelledAt || order.status === 'CANCELLED') throw new ConflictException('Заказ уже отменён');
      let data: Prisma.PurchaseOrderUpdateInput = {};
      let event = '';
      if (action === 'cancel') {
        if (order.paidAt || order.shippedAt || !['ORDERED', 'WAITING_PAYMENT'].includes(order.status)) {
          throw new ConflictException('Нельзя отменить оплаченный или отгруженный заказ');
        }
        if (!body.reason?.trim()) throw new BadRequestException('Укажите причину отмены');
        data = { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: body.reason.trim() };
        event = `Заказ у «${order.supplier.name}» отменён. Причина: ${body.reason.trim()}`;
      } else {
        const [expected, next] = transitions[action];
        if (order.status !== expected) throw new ConflictException(`Недопустимый этап заказа: ${order.status}. Ожидается ${expected}`);
        const now = new Date();
        if (action === 'send-to-payment') {
          if (!order.invoiceNumber) throw new BadRequestException('Не указан номер счёта');
          data = { status: 'WAITING_PAYMENT', sentToPaymentAt: now };
          event = `Счёт № ${order.invoiceNumber} поставщика «${order.supplier.name}» передан на оплату`;
        } else if (action === 'confirm-payment') {
          data = { status: 'WAITING_SHIPMENT', paidAt: now };
          event = `Оплата счёта № ${order.invoiceNumber} поставщика «${order.supplier.name}» подтверждена`;
        } else if (action === 'ship') {
          if (!body.shippedAt || !body.carrier?.trim()) throw new BadRequestException('Укажите дату отгрузки и перевозчика');
          const shippedAt = new Date(body.shippedAt);
          if (Number.isNaN(shippedAt.getTime())) throw new BadRequestException('Некорректная дата отгрузки');
          const expectedDeliveryAt = body.expectedDeliveryAt ? new Date(body.expectedDeliveryAt) : null;
          if (expectedDeliveryAt && (Number.isNaN(expectedDeliveryAt.getTime()) || expectedDeliveryAt < shippedAt)) {
            throw new BadRequestException('Дата прибытия не может быть раньше отгрузки');
          }
          data = { status: 'IN_TRANSIT', shippedAt, carrier: body.carrier.trim(), trackingNumber: body.trackingNumber?.trim() || null, expectedDeliveryAt };
          event = `Заказ отгружен поставщиком «${order.supplier.name}», перевозчик: ${body.carrier.trim()}${body.trackingNumber?.trim() ? `, ТТН: ${body.trackingNumber.trim()}` : ''}`;
        } else if (action === 'ready-for-pickup') {
          data = { status: 'READY_FOR_PICKUP', readyForPickupAt: now };
          event = `Груз прибыл от «${order.supplier.name}»`;
        } else if (action === 'receive') {
          data = { status: 'RECEIVED', receivedAt: now };
          event = `Товар получен от «${order.supplier.name}»`;
        } else if (action === 'hand-over') {
          if (!body.handedOverTo?.trim()) throw new BadRequestException('Укажите, кому передан товар');
          data = { status: 'HANDED_OVER', handedOverAt: now, handedOverTo: body.handedOverTo.trim() };
          // Keep the exact legacy activity prefix for history integrations.
          event = `Товар передан: ${body.handedOverTo.trim()}`;
        }
        data.status = next as 'ORDERED' | 'WAITING_PAYMENT' | 'WAITING_SHIPMENT' | 'IN_TRANSIT' | 'READY_FOR_PICKUP' | 'RECEIVED' | 'HANDED_OVER';
      }
      const updated = await tx.purchaseOrder.update({ where: { id: orderId }, data, include: { supplier: true, items: true } });
      if (action === 'cancel') {
        const other = await tx.purchaseOrder.count({ where: { taskId, supplierOfferId: order.supplierOfferId, cancelledAt: null } });
        if (!other) await tx.supplierOffer.update({ where: { id: order.supplierOfferId }, data: { status: 'OFFER_RECEIVED' } });
        const active = await tx.purchaseOrder.findFirst({ where: { taskId, cancelledAt: null }, orderBy: { createdAt: 'desc' } });
        await tx.task.update({ where: { id: taskId }, data: {
          currentPurchaseOrderId: active?.id ?? null, selectedOfferId: active?.supplierOfferId ?? null,
        } });
      }
      await this.refreshTask(tx, taskId);
      await tx.taskActivity.create({ data: { taskId, text: event } });
      return updated;
    }, { timeout: 15000 });
  }

  async closeTask(taskId: string) {
    return this.prisma.$transaction(async tx => {
      const task = await this.lockTask(tx, taskId);
      if (!task.items.length) throw new BadRequestException('В закупке нет позиций');
      const orders = await tx.purchaseOrder.findMany({ where: { taskId, cancelledAt: null }, include: { items: true } });
      if (!orders.length || orders.some(order => !order.items.length)) {
        throw new BadRequestException('Нет действующих заказов с позициями');
      }
      if (orders.some(order => order.status !== 'HANDED_OVER')) {
        throw new ConflictException('Не все действующие заказы переданы получателю');
      }
      const handed = new Map<string, number>();
      for (const order of orders) for (const item of order.items) {
        if (!item.taskItemId) continue;
        handed.set(item.taskItemId, (handed.get(item.taskItemId) ?? 0) + milli(item.quantity.toNumber()));
      }
      for (const item of task.items) {
        if ((handed.get(item.id) ?? 0) < milli(item.quantity.toNumber())) {
          throw new ConflictException(`Не вся позиция «${item.name}» передана получателю`);
        }
      }
      await tx.task.update({ where: { id: taskId }, data: {
        status: 'CLOSED', closedAt: new Date(), nextAction: null, reminderAt: null,
      } });
      await tx.taskActivity.create({ data: { taskId, text: 'Закупка закрыта' } });
      return tx.task.findUnique({ where: { id: taskId } });
    }, { timeout: 15000 });
  }
}
