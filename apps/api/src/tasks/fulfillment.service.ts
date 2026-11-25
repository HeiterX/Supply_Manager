import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FulfillmentDto } from './dto/fulfillment.dto.js';
import {
  financialBalance,
  invoiceBalance,
  ledgerInclude,
  lineBalance,
  openDiscrepancies,
  orderBlockers,
  quantityBalance,
  shipmentItemBalance,
  sum,
  zero,
  type LedgerOrder,
} from './fulfillment-balances.js';
import { MultiOrdersService } from './multi-orders.service.js';

type Tx = Prisma.TransactionClient;
type AuditRecord = { id: string };
type Change = { after: AuditRecord; before?: AuditRecord };

const financeActions = new Set([
  'approve-invoice',
  'register-payment',
  'cancel-payment',
]);
const requiresFinance = (user: AuthUser) =>
  user.role === 'ADMIN' && process.env.CORE08_FINANCE_ENABLED === 'true';

function text(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException('Укажите ' + label);
  return normalized;
}

function positive(value: string | undefined, label: string) {
  const amount = new Prisma.Decimal(text(value, label));
  if (!amount.gt(0))
    throw new BadRequestException(label + ' должно быть больше нуля');
  return amount;
}

function date(value: string | undefined) {
  const day = text(value, 'дату');
  const result = new Date(day + 'T00:00:00.000Z');
  if (
    day.startsWith('0000') ||
    !Number.isFinite(result.getTime()) ||
    result.toISOString().slice(0, 10) !== day
  ) {
    throw new BadRequestException('Некорректная календарная дата');
  }
  return result;
}

function actualDate(value: string | undefined) {
  const result = date(value);
  if (result > new Date())
    throw new BadRequestException('Дата события не может быть в будущем');
  return result;
}

function scoped<T extends { id: string }>(items: T[], id?: string) {
  const item = items.find((row) => row.id === id);
  if (!item) throw new NotFoundException('Запись не найдена в этом заказе');
  return item;
}

function snapshot(value: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly multiOrders: MultiOrdersService,
  ) {}

  async view(taskId: string, user: AuthUser) {
    return this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
          include: { items: true },
        });
        if (!task) throw new NotFoundException('Закупка не найдена');
        const orders = await tx.purchaseOrder.findMany({
          where: { taskId },
          include: ledgerInclude,
        });
        const operations = await tx.fulfillmentOperation.findMany({
          where: { taskId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          select: {
            id: true,
            actorId: true,
            orderId: true,
            action: true,
            resultId: true,
            createdAt: true,
            before: true,
            after: true,
          },
        });
        const actors = await tx.user.findMany({
          where: {
            id: {
              in: [
                ...new Set(operations.map((operation) => operation.actorId)),
              ],
            },
          },
          select: { id: true, fullName: true },
        });
        const actorNames = new Map(
          actors.map((actor) => [actor.id, actor.fullName]),
        );
        const positions = task.items.map((item) => {
          const lines = orders
            .filter((order) => !order.cancelledAt)
            .flatMap((order) =>
              order.items
                .filter((line) => line.taskItemId === item.id)
                .map((line) => ({ order, line })),
            );
          const ordered = sum(lines.map(({ line }) => line.quantity));
          const shipped = sum(
            lines.map(({ order, line }) =>
              order.ledgerEnabled
                ? lineBalance(order, line).shipped
                : order.shippedAt
                  ? line.quantity
                  : zero,
            ),
          );
          const received = sum(
            lines.map(({ line, order }) =>
              order.ledgerEnabled
                ? quantityBalance(line.fulfillmentEvents).received
                : order.receivedAt
                  ? line.quantity
                  : zero,
            ),
          );
          const returned = sum(
            lines.map(
              ({ line }) => quantityBalance(line.fulfillmentEvents).returned,
            ),
          );
          const handedOver = sum(
            lines.map(({ line, order }) =>
              order.ledgerEnabled
                ? quantityBalance(line.fulfillmentEvents).handedOver
                : order.handedOverAt
                  ? line.quantity
                  : zero,
            ),
          );
          return {
            id: item.id,
            name: item.name,
            unit: item.unit,
            requested: item.quantity,
            ordered,
            unordered: item.quantity.minus(ordered),
            shipped,
            received,
            returned,
            accepted: received.minus(returned),
            handedOver,
            remaining: item.quantity.minus(handedOver),
          };
        });
        return {
          canRecordFinance: requiresFinance(user),
          locked: task.status === 'CLOSED' || task.status === 'CANCELLED',
          protectedDocumentsAvailable: false,
          positions,
          operations: operations.map((operation) => ({
            ...operation,
            actorName: actorNames.get(operation.actorId) ?? null,
          })),
          blockers: [
            ...(!orders.some(
              (order) => !order.cancelledAt && order.items.length,
            )
              ? ['Нет действующих заказов с позициями']
              : []),
            ...(!positions.length ? ['В закупке нет позиций'] : []),
            ...positions
              .filter((row) => row.remaining.gt(0))
              .map(
                (row) =>
                  row.name +
                  ': осталось передать ' +
                  row.remaining +
                  ' ' +
                  row.unit,
              ),
            ...orders.flatMap((order) => orderBlockers(order)),
          ],
          orders: orders.map((order) => ({
            id: order.id,
            supplierId: order.supplierId,
            legacyInvoiceNumber: order.invoiceNumber,
            ledgerEnabled: order.ledgerEnabled,
            canEnableLedger: this.canEnable(order),
            cancelledAt: order.cancelledAt,
            totalPrice: order.totalPrice,
            currency: 'RUB',
            finance: order.ledgerEnabled ? financialBalance(order) : null,
            invoices: order.invoices.map((invoice) => ({
              ...invoice,
              ...invoiceBalance(invoice),
            })),
            shipments: order.shipments.map((shipment) => {
              const items = shipment.items.map((item) => ({
                ...item,
                ...shipmentItemBalance(item),
              }));
              const status = shipment.cancelledAt
                ? 'CANCELLED'
                : shipment.shortClosedAt
                  ? 'SHORT_CLOSED'
                  : items.every((item) => item.received.eq(item.quantity))
                    ? 'RECEIVED'
                    : items.some((item) => item.received.gt(0))
                      ? 'PARTIALLY_RECEIVED'
                      : shipment.arrivedOn
                        ? 'ARRIVED'
                        : shipment.shippedOn
                          ? 'IN_TRANSIT'
                          : 'WAITING_DISPATCH';
              return { ...shipment, items, status };
            }),
            items: order.items.map((item) => ({
              ...item,
              ...lineBalance(order, item),
              openDiscrepancies: openDiscrepancies(item),
            })),
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async execute(
    taskId: string,
    orderId: string,
    dto: FulfillmentDto,
    user: AuthUser,
  ) {
    if (financeActions.has(dto.action) && !requiresFinance(user)) {
      throw new ForbiddenException(
        'Регистрация и согласование оплаты недоступны для этой учётной записи',
      );
    }
    const identity = Object.entries(dto).filter(
      ([name, value]) => name !== 'key' && value !== undefined,
    );
    identity.sort(([left], [right]) => left.localeCompare(right));
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([orderId, user.id, identity]))
      .digest('hex');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const task = await this.multiOrders.lockTask(tx, taskId, true);
          const earlier = await tx.fulfillmentOperation.findUnique({
            where: { taskId_key: { taskId, key: dto.key } },
          });
          if (earlier) {
            if (earlier.fingerprint !== fingerprint)
              throw new ConflictException(
                'Ключ повтора уже использован для другой операции',
              );
            return { id: earlier.resultId, replayed: true };
          }
          if (task.status === 'CLOSED' || task.status === 'CANCELLED') {
            throw new ConflictException(
              'Закрытую или отменённую закупку нельзя изменять',
            );
          }
          const order = await tx.purchaseOrder.findFirst({
            where: { id: orderId, taskId },
            include: ledgerInclude,
          });
          if (!order)
            throw new NotFoundException('Заказ не найден в этой закупке');
          if (order.cancelledAt) throw new ConflictException('Заказ отменён');
          const change = await this.apply(tx, order, dto, user.id);
          await tx.fulfillmentOperation.create({
            data: {
              taskId,
              orderId,
              key: dto.key,
              fingerprint,
              actorId: user.id,
              action: dto.action,
              resultId: change.after.id,
              before: change.before ? snapshot(change.before) : undefined,
              after: snapshot({
                ...change.after,
                auditComment: dto.comment?.trim() || null,
              }),
            },
          });
          await this.synchronize(tx, taskId, orderId);
          return { id: change.after.id, replayed: false };
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Запись с этим номером или подтверждением уже существует',
        );
      }
      throw error;
    }
  }

  private canEnable(order: LedgerOrder) {
    return (
      !order.ledgerEnabled &&
      !order.cancelledAt &&
      order.items.length > 0 &&
      order.items.every((item) => item.taskItemId && item.currency === 'RUB') &&
      order.status === 'ORDERED' &&
      !order.sentToPaymentAt &&
      !order.paidAt &&
      !order.shippedAt &&
      !order.receivedAt &&
      !order.handedOverAt
    );
  }

  private async apply(
    tx: Tx,
    order: LedgerOrder,
    dto: FulfillmentDto,
    actorId: string,
  ): Promise<Change> {
    if (dto.action === 'enable-ledger') {
      if (!this.canEnable(order))
        throw new ConflictException(
          'Заказ требует сверки исторических операций',
        );
      const after = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { ledgerEnabled: true },
        select: { id: true, ledgerEnabled: true },
      });
      return { after };
    }
    if (!order.ledgerEnabled)
      throw new ConflictException(
        'Для заказа требуется сверка и подключение учёта',
      );
    if (dto.action.endsWith('-invoice'))
      return this.invoice(tx, order, dto, actorId);
    if (dto.action.endsWith('-payment'))
      return this.payment(tx, order, dto, actorId);
    if (dto.action.endsWith('-shipment'))
      return this.shipment(tx, order, dto, actorId);
    return this.stockEvent(tx, order, dto, actorId);
  }

  private async invoice(
    tx: Tx,
    order: LedgerOrder,
    dto: FulfillmentDto,
    actorId: string,
  ): Promise<Change> {
    const before =
      dto.action === 'create-invoice'
        ? undefined
        : scoped(order.invoices, dto.targetId);
    if (before?.cancelledAt) throw new ConflictException('Счёт отменён');
    if (dto.action === 'approve-invoice') {
      if (!before || before.approvedAt)
        throw new ConflictException('Счёт уже согласован');
      return {
        before,
        after: await tx.invoice.update({
          where: { id: before.id },
          data: { approvedAt: new Date(), actorId },
        }),
      };
    }
    if (before?.payments.length)
      throw new ConflictException(
        'Для счёта с историей платежей требуется согласованная корректировка',
      );
    if (dto.action === 'cancel-invoice' && before) {
      text(dto.comment, 'причину отмены');
      return {
        before,
        after: await tx.invoice.update({
          where: { id: before.id },
          data: { cancelledAt: new Date(), actorId },
        }),
      };
    }
    if (before?.approvedAt)
      throw new ConflictException(
        'Согласованный счёт можно отменить и зарегистрировать заново',
      );
    if (dto.currency !== 'RUB')
      throw new BadRequestException(
        'Валюта счёта должна совпадать с валютой заказа (RUB)',
      );
    const amount = positive(dto.amount, 'Сумма счёта');
    const previous = sum(
      order.invoices
        .filter((invoice) => !invoice.cancelledAt && invoice.id !== before?.id)
        .map((invoice) => invoice.amount),
    );
    if (!order.totalPrice || previous.plus(amount).gt(order.totalPrice)) {
      throw new ConflictException(
        'Сумма действующих счетов превышает стоимость заказа или стоимость не указана',
      );
    }
    const issuedOn = date(dto.date);
    const dueOn = dto.dueOn ? date(dto.dueOn) : null;
    if (dueOn && dueOn < issuedOn)
      throw new BadRequestException(
        'Срок оплаты раньше даты выставления счёта',
      );
    const data = {
      number: text(dto.number, 'номер счёта'),
      amount,
      currency: dto.currency,
      issuedOn,
      dueOn,
      comment: dto.comment?.trim() || null,
      actorId,
    };
    const after = before
      ? await tx.invoice.update({ where: { id: before.id }, data })
      : await tx.invoice.create({
          data: { ...data, purchaseOrderId: order.id },
        });
    return { before, after };
  }

  private async payment(
    tx: Tx,
    order: LedgerOrder,
    dto: FulfillmentDto,
    actorId: string,
  ): Promise<Change> {
    if (dto.action === 'cancel-payment') {
      const before = scoped(
        order.invoices.flatMap((invoice) => invoice.payments),
        dto.targetId,
      );
      if (before.cancelledAt) throw new ConflictException('Платёж уже отменён');
      text(dto.comment, 'причину корректировки');
      const after = await tx.payment.update({
        where: { id: before.id },
        data: { cancelledAt: new Date() },
      });
      return { before, after };
    }
    const invoice = scoped(order.invoices, dto.targetId);
    if (invoice.cancelledAt || !invoice.approvedAt)
      throw new ConflictException(
        'Для оплаты требуется согласованный действующий счёт',
      );
    if (dto.currency !== invoice.currency)
      throw new BadRequestException(
        'Валюта платежа должна совпадать с валютой счёта',
      );
    const amount = positive(dto.amount, 'Сумма платежа');
    if (amount.gt(invoiceBalance(invoice).remaining))
      throw new ConflictException('Платёж превышает остаток счёта');
    const paidOn = actualDate(dto.date);
    if (paidOn < invoice.issuedOn)
      throw new BadRequestException('Дата платежа раньше даты счёта');
    const after = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        amount,
        currency: invoice.currency,
        paidOn,
        reference: text(dto.number, 'номер подтверждения'),
        comment: dto.comment?.trim() || null,
        actorId,
      },
    });
    return { after };
  }

  private async shipment(
    tx: Tx,
    order: LedgerOrder,
    dto: FulfillmentDto,
    actorId: string,
  ): Promise<Change> {
    if (dto.action === 'create-shipment') {
      if (
        !dto.items?.length ||
        new Set(dto.items.map((item) => item.itemId)).size !== dto.items.length
      ) {
        throw new BadRequestException(
          'Выберите неповторяющиеся позиции партии',
        );
      }
      const items = dto.items.map((input) => {
        const item = scoped(order.items, input.itemId);
        const quantity = positive(input.quantity, 'Количество партии');
        const reserved = sum(
          order.shipments
            .filter((shipment) => !shipment.cancelledAt)
            .flatMap((shipment) =>
              shipment.items
                .filter((line) => line.purchaseOrderItemId === item.id)
                .map((line) => {
                  const balance = shipmentItemBalance(line);
                  return shipment.shortClosedAt
                    ? balance.accepted
                    : line.quantity.minus(balance.returned);
                }),
            ),
        );
        if (reserved.plus(quantity).gt(item.quantity))
          throw new ConflictException(
            'Количество партии превышает доступное для отгрузки',
          );
        return { purchaseOrderItemId: item.id, quantity };
      });
      const after = await tx.shipment.create({
        data: {
          purchaseOrderId: order.id,
          actorId,
          number: text(dto.number, 'номер партии'),
          expectedOn: dto.expectedOn ? date(dto.expectedOn) : null,
          comment: dto.comment?.trim() || null,
          items: { create: items },
        },
        include: { items: true },
      });
      return { after };
    }
    const before = scoped(order.shipments, dto.targetId);
    if (before.cancelledAt || before.shortClosedAt)
      throw new ConflictException('Партия уже завершена или отменена');
    let data: Prisma.ShipmentUpdateInput;
    if (dto.action === 'cancel-shipment') {
      if (before.shippedOn)
        throw new ConflictException('Отгруженную партию нельзя отменить');
      text(dto.comment, 'причину отмены');
      data = { cancelledAt: new Date() };
    } else if (dto.action === 'dispatch-shipment') {
      if (before.shippedOn) throw new ConflictException('Партия уже отгружена');
      const shippedOn = actualDate(dto.date);
      const expectedOn = dto.expectedOn
        ? date(dto.expectedOn)
        : before.expectedOn;
      if (expectedOn && expectedOn < shippedOn)
        throw new BadRequestException('Плановая дата раньше даты отгрузки');
      data = {
        shippedOn,
        expectedOn,
        carrier: text(dto.carrier, 'перевозчика'),
        trackingNumber: dto.trackingNumber?.trim() || null,
      };
    } else if (dto.action === 'arrive-shipment') {
      if (!before.shippedOn || before.arrivedOn)
        throw new ConflictException(
          'Прибытие можно отметить один раз после отгрузки',
        );
      const arrivedOn = actualDate(dto.date);
      if (arrivedOn < before.shippedOn)
        throw new BadRequestException('Прибытие раньше отгрузки');
      data = { arrivedOn };
    } else {
      if (!before.arrivedOn)
        throw new ConflictException(
          'Недопоставку можно оформить после прибытия',
        );
      text(dto.comment, 'основание закрытия партии');
      const shortages = before.items.filter((line) =>
        shipmentItemBalance(line).received.lt(line.quantity),
      );
      if (
        !shortages.length ||
        shortages.some((line) => {
          const missing = line.quantity.minus(
            shipmentItemBalance(line).received,
          );
          return !line.events.some(
            (event) =>
              event.kind === 'DISCREPANCY' &&
              event.reason === 'SHORTAGE' &&
              event.quantity.eq(missing),
          );
        })
      ) {
        throw new ConflictException(
          'Зафиксируйте недостающее количество каждой позиции партии',
        );
      }
      data = { shortClosedAt: new Date() };
    }
    return {
      before,
      after: await tx.shipment.update({ where: { id: before.id }, data }),
    };
  }

  private async stockEvent(
    tx: Tx,
    order: LedgerOrder,
    dto: FulfillmentDto,
    actorId: string,
  ): Promise<Change> {
    const shipment = order.shipments.find((row) =>
      row.items.some((item) => item.id === dto.targetId),
    );
    const shipmentItem = shipment?.items.find(
      (item) => item.id === dto.targetId,
    );
    const discrepancy =
      dto.action === 'resolve-discrepancy'
        ? scoped(
            order.items.flatMap((item) => item.fulfillmentEvents),
            dto.targetId,
          )
        : undefined;
    const item = scoped(
      order.items,
      shipmentItem?.purchaseOrderItemId ??
        discrepancy?.purchaseOrderItemId ??
        dto.targetId,
    );
    const balance = quantityBalance(item.fulfillmentEvents);
    const occurredOn = actualDate(dto.date);
    const quantity =
      discrepancy?.quantity ?? positive(dto.quantity, 'Количество');
    const data: Omit<Prisma.FulfillmentEventUncheckedCreateInput, 'kind'> = {
      purchaseOrderItemId: item.id,
      shipmentItemId: shipmentItem?.id,
      quantity,
      actorId,
      occurredOn,
      comment: dto.comment?.trim() || null,
    };
    if (shipment?.cancelledAt) throw new ConflictException('Партия отменена');
    if (shipment?.arrivedOn && occurredOn < shipment.arrivedOn)
      throw new BadRequestException('Дата операции раньше прибытия партии');
    let kind: Prisma.FulfillmentEventUncheckedCreateInput['kind'];
    switch (dto.action) {
      case 'receive': {
        if (!shipment?.arrivedOn || shipment.shortClosedAt || !shipmentItem)
          throw new ConflictException(
            'Приёмка доступна только по прибывшей открытой партии',
          );
        if (
          shipmentItemBalance(shipmentItem)
            .received.plus(quantity)
            .gt(shipmentItem.quantity) ||
          balance.accepted.plus(quantity).gt(item.quantity)
        )
          throw new ConflictException('Количество превышает остаток приёмки');
        kind = 'RECEIPT';
        break;
      }
      case 'return':
        if (
          !shipmentItem ||
          quantity.gt(shipmentItemBalance(shipmentItem).accepted) ||
          quantity.gt(balance.accepted.minus(balance.handedOver))
        )
          throw new ConflictException(
            'Возврат превышает принятое и ещё не переданное количество',
          );
        text(dto.comment, 'причину возврата');
        kind = 'RETURN';
        break;
      case 'handover':
        if (
          shipmentItem ||
          quantity.gt(balance.accepted.minus(balance.handedOver))
        )
          throw new ConflictException(
            'Передача превышает принятое доступное количество',
          );
        text(dto.comment, 'получателя');
        kind = 'HANDOVER';
        break;
      case 'report-discrepancy':
        if (!dto.reason || !shipment?.arrivedOn || !shipmentItem)
          throw new BadRequestException(
            'Укажите причину и позицию прибывшей партии',
          );
        if (quantity.gt(shipmentItem.quantity))
          throw new ConflictException('Расхождение превышает размер партии');
        data.reason = dto.reason;
        kind = 'DISCREPANCY';
        break;
      case 'resolve-discrepancy':
        if (
          !discrepancy ||
          discrepancy.kind !== 'DISCREPANCY' ||
          !openDiscrepancies(item).some((event) => event.id === discrepancy.id)
        ) {
          throw new ConflictException(
            'Расхождение уже закрыто или отсутствует',
          );
        }
        if (occurredOn < discrepancy.occurredOn)
          throw new BadRequestException(
            'Дата урегулирования раньше даты расхождения',
          );
        text(dto.comment, 'решение по расхождению');
        data.resolvesId = discrepancy.id;
        data.shipmentItemId = discrepancy.shipmentItemId;
        kind = 'RESOLUTION';
        break;
      default:
        throw new BadRequestException('Неизвестная операция');
    }
    const after = await tx.fulfillmentEvent.create({ data: { ...data, kind } });
    return { after };
  }

  private async synchronize(tx: Tx, taskId: string, orderId: string) {
    const order = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: ledgerInclude,
    });
    const finance = financialBalance(order);
    const allReceived = order.items.every((item) =>
      lineBalance(order, item).remaining.eq(0),
    );
    const complete = orderBlockers(order).length === 0;
    const shipped = order.shipments.find((shipment) => shipment.shippedOn);
    const arrived = order.shipments.find((shipment) => shipment.arrivedOn);
    const now = new Date();
    const status = complete
      ? 'HANDED_OVER'
      : allReceived
        ? 'RECEIVED'
        : arrived
          ? 'READY_FOR_PICKUP'
          : shipped
            ? 'IN_TRANSIT'
            : finance.settled
              ? 'WAITING_SHIPMENT'
              : order.invoices.some((invoice) => !invoice.cancelledAt)
                ? 'WAITING_PAYMENT'
                : 'ORDERED';
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: {
        status,
        version: { increment: 1 },
        shippedAt: order.shippedAt ?? shipped?.shippedOn,
        readyForPickupAt: order.readyForPickupAt ?? arrived?.arrivedOn,
        paidAt: finance.settled ? (order.paidAt ?? now) : null,
        receivedAt: allReceived ? (order.receivedAt ?? now) : null,
        handedOverAt: order.items.every((item) =>
          quantityBalance(item.fulfillmentEvents).handedOver.eq(item.quantity),
        )
          ? (order.handedOverAt ?? now)
          : null,
      },
    });
    await this.multiOrders.refreshTask(tx, taskId);
  }
}
