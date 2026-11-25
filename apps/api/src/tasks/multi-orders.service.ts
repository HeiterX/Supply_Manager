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
import { SuppliersService } from './suppliers.service.js';
import { offerSnapshot, quotePrice } from './quote-utils.js';
import { orderCreateFingerprint, orderSnapshot } from './order-utils.js';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto.js';

const milli = (value: number) => Math.round(value * 1000);
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

@Injectable()
export class MultiOrdersService {
  constructor(private readonly prisma: PrismaService, private readonly suppliers: SuppliersService) {}

  // A row lock serializes all allocations for the same procurement task.
  private async lockTask(tx: Prisma.TransactionClient, taskId: string) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is not defined');
    const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
    // PrismaPg uses a configured schema for model queries. Raw SQL needs the
    // same transaction-local search_path (notably for isolated e2e schema).
    const searchPath = '"' + schema.replaceAll('"', '""') + '", public';
    await tx.$queryRaw`SELECT pg_catalog.set_config('search_path', ${searchPath}, true)`;
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

  async updateOffer(taskId: string, offerId: string, dto: CreateSupplierOfferDto, actorId?: string) {
    if ((!dto.supplierId && !dto.supplierName?.trim()) || !dto.items?.length) {
      throw new BadRequestException('Укажите поставщика и позиции КП');
    }
    if (dto.validUntil && new Date(dto.validUntil).getTime() < Date.now()) {
      throw new BadRequestException('Нельзя установить истёкший срок КП');
    }
    const pricing = quotePrice(dto);
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
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== offer.version) {
        throw new ConflictException('КП изменено другим пользователем. Перезагрузите страницу');
      }
      if (offer.status === 'REJECTED') {
        throw new ConflictException('Отклонённое КП нельзя редактировать');
      }
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
      const supplier = await this.suppliers.resolveForOffer(tx, dto, actorId);
      const hadRevision = await tx.supplierOfferRevision.count({ where: { offerId } });
      if (!hadRevision) {
        const baseline = await tx.supplierOffer.findUniqueOrThrow({
          where: { id: offerId }, include: { items: true },
        });
        await tx.supplierOfferRevision.create({ data: {
          offerId, version: baseline.version, actorId: actorId ?? null,
          action: 'BASELINE', snapshot: offerSnapshot(baseline),
        } });
      }
      const updated = await tx.supplierOffer.update({ where: { id: offerId }, data: {
        supplierId: supplier.id,
        version: { increment: 1 },
        price: pricing.price, currency: pricing.currency,
        deliveryPrice: dto.deliveryPrice ?? null, deliveryDays: dto.deliveryDays ?? null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        paymentTerms: dto.paymentTerms?.trim() || null,
        deliveryTerms: dto.deliveryTerms?.trim() || null,
        notes: dto.notes?.trim() || null, status: 'OFFER_RECEIVED',
        decisionReason: null, decidedById: null, decidedAt: null,
        items: { deleteMany: {}, create: items.map(item => ({
          taskItemId: item.taskItemId, quantity: item.quantity, unitPrice: item.unitPrice,
          currency: pricing.currency ?? item.currency?.trim().toUpperCase() ?? 'RUB',
          inStock: item.inStock, notes: item.notes?.trim() || null,
        })) },
      }, include: { supplier: true, items: { include: { taskItem: true } } } });
      await tx.supplierOfferRevision.create({ data: {
        offerId, version: updated.version, actorId: actorId ?? null,
        action: 'UPDATED', snapshot: offerSnapshot(updated),
      } });
      await tx.task.updateMany({
        where: { id: taskId, selectedOfferId: offerId },
        data: { selectedOfferId: null },
      });
      await tx.taskActivity.create({ data: {
        taskId, text: `КП поставщика «${updated.supplier.name}» обновлено до версии ${updated.version}`,
      } });
      return updated;
    }, { timeout: 15000 });
  }

  async selectOffer(taskId: string, offerId: string, reason: string, actorId: string) {
    const decisionReason = reason?.trim();
    if (!decisionReason || decisionReason.length < 10 || decisionReason.length > 2000) {
      throw new BadRequestException('Причина выбора должна содержать от 10 до 2000 символов');
    }
    return this.prisma.$transaction(async tx => {
      await this.lockTask(tx, taskId);
      const offer = await tx.supplierOffer.findFirst({
        where: { taskId, id: offerId },
        include: { items: true, supplier: true },
      });
      if (!offer) throw new NotFoundException('КП не найдено');
      if (!offer.items.length) throw new ConflictException('Выбрать КП без позиций нельзя');
      if (offer.validUntil && offer.validUntil.getTime() < Date.now()) {
        throw new ConflictException('Срок действия КП истёк');
      }
      if (offer.supplier.status !== 'ACTIVE') {
        throw new ConflictException('Поставщик заблокирован или приостановлен');
      }
      const existingOrders = await tx.purchaseOrder.count({ where: { supplierOfferId: offerId } });
      if (existingOrders) throw new ConflictException('КП уже использовалось в заказе; решение нельзя переписать');
      const updated = await tx.supplierOffer.update({
        where: { id: offerId },
        data: {
          status: 'SELECTED', decisionReason, decidedById: actorId, decidedAt: new Date(),
        },
        include: { items: true, supplier: true },
      });
      await tx.supplierOfferRevision.create({ data: {
        offerId, version: updated.version, actorId, action: 'SELECTED',
        snapshot: offerSnapshot(updated),
      } });
      await tx.taskActivity.create({ data: {
        taskId, text: `Вручную выбрано КП «${updated.supplier.name}» (версия ${updated.version}). Причина: ${decisionReason}`,
      } });
      return updated;
    }, { timeout: 15000 });
  }

  async createOrder(taskId: string, offerId: string, dto: CreatePurchaseOrderDto, actorId?: string) {
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
    const fingerprint = dto.idempotencyKey ? orderCreateFingerprint(offerId, dto) : null;
    const assertReplay = (order: { requestFingerprint: string | null }) => {
      if (order.requestFingerprint !== fingerprint) {
        throw new ConflictException('Ключ повтора уже применён для другого состава заказа');
      }
    };
    if (dto.idempotencyKey) {
      const earlier = await this.prisma.purchaseOrder.findFirst({
        where: { taskId, idempotencyKey: dto.idempotencyKey },
        include: { items: true, supplier: true },
      });
      if (earlier) {
        assertReplay(earlier);
        return earlier;
      }
    }
    return this.prisma.$transaction(async tx => {
      await this.lockTask(tx, taskId);
      if (dto.idempotencyKey) {
        // Второй concurrent request ждёт блокировки закупки и видит первый заказ.
        const earlier = await tx.purchaseOrder.findFirst({
          where: { taskId, idempotencyKey: dto.idempotencyKey },
          include: { items: true, supplier: true },
        });
        if (earlier) {
          assertReplay(earlier);
          return earlier;
        }
      }
      const offer = await tx.supplierOffer.findFirst({
        where: { id: offerId, taskId },
        include: { supplier: true, items: { include: { taskItem: true } } },
      });
      if (!offer) throw new NotFoundException('Предложение поставщика не найдено');
      if (!offer.items.length) throw new BadRequestException('У КП нет позиций. Создайте новое КП с позициями');
      if (!offer.decisionReason || offer.status !== 'SELECTED') {
        throw new ConflictException('Перед заказом выберите КП вручную и укажите причину решения');
      }
      if (offer.validUntil && offer.validUntil.getTime() < Date.now()) {
        throw new ConflictException('Срок действия КП истёк');
      }
      if (offer.supplier.status !== 'ACTIVE') {
        throw new ConflictException('Поставщик заблокирован или приостановлен');
      }
      if (offer.currency !== 'RUB') {
        throw new ConflictException('Оформление заказа пока доступно только для КП в RUB; пересчёт валют запрещён');
      }
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
          throw new ConflictException(`«${offerItem.taskItem.name}»: доступно ${Math.max(0, remaining) / 1000} ${offerItem.taskItem.unit}, поставщик предложил ${offerItem.quantity.toString()} ${offerItem.taskItem.unit}`);
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
          idempotencyKey: dto.idempotencyKey ?? null,
          requestFingerprint: fingerprint,
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
      await tx.purchaseOrderRevision.create({ data: {
        purchaseOrderId: order.id, action: 'CREATED', version: order.version,
        actorId: actorId ?? null, after: orderSnapshot(order),
      } });
      await tx.taskActivity.create({ data: { taskId, text: `Оформлен заказ у «${offer.supplier.name}», счёт № ${order.invoiceNumber}, ${lines.length} поз.` } });
      return order;
    }, { timeout: 15000 });
  }

  async allocation(taskId: string) {
    const [task, orders] = await Promise.all([
      this.prisma.task.findUnique({
        where: { id: taskId }, include: { items: { orderBy: { sortOrder: 'asc' } } },
      }),
      this.prisma.purchaseOrder.findMany({
        where: { taskId }, include: { items: true, supplier: { select: { id: true, name: true } } },
      }),
    ]);
    if (!task) throw new NotFoundException('Закупка не найдена');
    return task.items.map(item => {
      const required = milli(item.quantity.toNumber());
      let ordered = 0;
      let reserved = 0;
      let cancelled = 0;
      let paidOrLater = 0;
      const bySupplier: Array<{
        orderId: string; supplierId: string; supplierName: string;
        status: string; quantity: number; active: boolean;
      }> = [];
      for (const order of orders) {
        for (const line of order.items) {
          if (line.taskItemId !== item.id) continue;
          const quantity = milli(line.quantity.toNumber());
          const isCancelled = order.cancelledAt !== null || order.status === 'CANCELLED';
          if (isCancelled) cancelled += quantity;
          else {
            ordered += quantity;
            if (['ORDERED', 'WAITING_PAYMENT'].includes(order.status)) reserved += quantity;
            else paidOrLater += quantity;
          }
          bySupplier.push({
            orderId: order.id, supplierId: order.supplierId,
            supplierName: order.supplier.name, status: order.status,
            quantity: quantity / 1000, active: !isCancelled,
          });
        }
      }
      return {
        taskItemId: item.id, name: item.name, unit: item.unit,
        required: required / 1000, reserved: reserved / 1000,
        ordered: ordered / 1000, paidOrLater: paidOrLater / 1000,
        cancelled: cancelled / 1000, available: Math.max(0, required - ordered) / 1000,
        bySupplier,
      };
    });
  }

  async updateOrder(
    taskId: string,
    orderId: string,
    dto: UpdatePurchaseOrderDto,
    actorId?: string,
  ) {
    if (new Set(dto.items.map(item => item.supplierOfferItemId)).size !== dto.items.length) {
      throw new BadRequestException('Повторяющиеся позиции заказа');
    }
    return this.prisma.$transaction(async tx => {
      await this.lockTask(tx, taskId);
      const existing = await tx.purchaseOrder.findFirst({
        where: { id: orderId, taskId },
        include: { items: true, supplier: true },
      });
      if (!existing) throw new NotFoundException('Заказ не найден в закупке');
      if (!existing.items.length) throw new ConflictException('Заказы старого формата изменяются в прежнем сценарии');
      if (existing.cancelledAt || existing.paidAt || existing.shippedAt ||
          !['ORDERED', 'WAITING_PAYMENT'].includes(existing.status)) {
        throw new ConflictException('Редактирование возможно только до оплаты и отгрузки');
      }
      if (dto.expectedVersion !== existing.version) {
        throw new ConflictException('Заказ уже изменён другим пользователем. Обновите страницу');
      }
      const offer = await tx.supplierOffer.findFirst({
        where: { id: existing.supplierOfferId, taskId },
        include: { items: { include: { taskItem: true } }, supplier: true },
      });
      if (!offer || offer.supplier.status !== 'ACTIVE') {
        throw new ConflictException('КП или поставщик больше не доступны');
      }
      const currentOrders = await tx.purchaseOrder.findMany({
        where: { taskId, cancelledAt: null, id: { not: orderId } },
        include: { items: true },
      });
      if (currentOrders.some(order => !order.items.length)) {
        throw new ConflictException('В закупке есть заказ старого формата');
      }
      const allocated = new Map<string, number>();
      for (const order of currentOrders) for (const line of order.items) {
        if (!line.taskItemId) continue;
        allocated.set(line.taskItemId,
          (allocated.get(line.taskItemId) ?? 0) + milli(line.quantity.toNumber()));
      }
      const offered = new Map(offer.items.map(item => [item.id, item]));
      const lines = dto.items.map(line => {
        const source = offered.get(line.supplierOfferItemId);
        if (!source) throw new BadRequestException('Позиция не относится к исходному КП');
        const quantity = Number(line.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0 || milli(quantity) !== quantity * 1000) {
          throw new BadRequestException('Количество должно быть положительным, до 3 знаков после запятой');
        }
        const requested = milli(quantity);
        const available = milli(source.taskItem.quantity.toNumber()) -
          (allocated.get(source.taskItemId) ?? 0);
        if (requested > milli(source.quantity.toNumber()) || requested > available) {
          throw new ConflictException(`«${source.taskItem.name}»: недостаточно остатка для изменения заказа`);
        }
        allocated.set(source.taskItemId, (allocated.get(source.taskItemId) ?? 0) + requested);
        if (source.currency !== 'RUB') {
          throw new ConflictException('Изменение заказа в валюте, отличной от RUB, запрещено');
        }
        return { source, quantity };
      });
      const invoiceNumber = dto.invoiceNumber === undefined
        ? existing.invoiceNumber : dto.invoiceNumber.trim();
      const invoiceDate = dto.invoiceDate === undefined
        ? existing.invoiceDate : new Date(dto.invoiceDate);
      if (!invoiceNumber || !invoiceDate) {
        throw new BadRequestException('Номер и дата счёта обязательны');
      }
      const hasPrices = lines.every(line => line.source.unitPrice !== null);
      const price = hasPrices
        ? money(lines.reduce((sum, line) =>
            sum + line.quantity * line.source.unitPrice!.toNumber(), 0))
        : null;
      const totalPrice = price === null ? null
        : money(price + (existing.deliveryPrice?.toNumber() ?? 0));
      const before = orderSnapshot(existing);
      const existingRevisions = await tx.purchaseOrderRevision.count({
        where: { purchaseOrderId: orderId },
      });
      if (!existingRevisions) {
        await tx.purchaseOrderRevision.create({
          data: {
            purchaseOrderId: orderId, action: 'BASELINE', version: existing.version,
            actorId: actorId ?? null, after: before,
          },
        });
      }
      const updated = await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          version: { increment: 1 },
          status: 'ORDERED',
          sentToPaymentAt: null,
          invoiceNumber,
          invoiceDate,
          notes: dto.notes === undefined ? existing.notes : dto.notes.trim() || null,
          price, totalPrice,
          items: {
            deleteMany: {},
            create: lines.map(({ source, quantity }) => ({
              taskItemId: source.taskItemId,
              supplierOfferItemId: source.id,
              name: source.taskItem.name,
              partNumber: source.taskItem.partNumber,
              quantity, unit: source.taskItem.unit,
              unitPrice: source.unitPrice,
              currency: source.currency,
              notes: source.notes,
            })),
          },
        },
        include: { supplier: true, items: true },
      });
      await tx.purchaseOrderRevision.create({
        data: {
          purchaseOrderId: orderId, action: 'UPDATED', version: updated.version,
          actorId: actorId ?? null, before, after: orderSnapshot(updated),
        },
      });
      await this.refreshTask(tx, taskId);
      await tx.taskActivity.create({
        data: { taskId,
          text: `Заказ у «${updated.supplier.name}», счёт № ${updated.invoiceNumber} отредактирован; версия ${updated.version}; статус оплаты сброшен к оформлению`,
        },
      });
      return updated;
    }, { timeout: 15000 });
  }

  async action(
    taskId: string, orderId: string, action: string,
    body: { reason?: string; handedOverTo?: string; shippedAt?: string; carrier?: string; trackingNumber?: string; expectedDeliveryAt?: string } = {},
    actorId?: string,
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
      const before = orderSnapshot(order);
      const revisionCount = await tx.purchaseOrderRevision.count({ where: { purchaseOrderId: orderId } });
      if (!revisionCount) {
        await tx.purchaseOrderRevision.create({
          data: {
            purchaseOrderId: orderId, action: 'BASELINE', version: order.version,
            actorId: actorId ?? null, after: before,
          },
        });
      }
      data.version = { increment: 1 };
      const updated = await tx.purchaseOrder.update({
        where: { id: orderId }, data, include: { supplier: true, items: true },
      });
      await tx.purchaseOrderRevision.create({
        data: {
          purchaseOrderId: orderId,
          action: action === 'cancel' ? 'CANCELLED' : action.toUpperCase().replaceAll('-', '_'),
          version: updated.version, actorId: actorId ?? null,
          before, after: orderSnapshot(updated),
        },
      });
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
