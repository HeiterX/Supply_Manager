import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

export const ledgerInclude = {
  invoices: {
    orderBy: { createdAt: 'asc' },
    include: { payments: { orderBy: { createdAt: 'asc' } } },
  },
  shipments: {
    orderBy: { createdAt: 'asc' },
    include: {
      items: { include: { events: { orderBy: { createdAt: 'asc' } } } },
    },
  },
  items: { include: { fulfillmentEvents: { orderBy: { createdAt: 'asc' } } } },
} as const satisfies Prisma.PurchaseOrderInclude;

export type LedgerOrder = Prisma.PurchaseOrderGetPayload<{
  include: typeof ledgerInclude;
}>;
export type LedgerLine = LedgerOrder['items'][number];

export const zero = new Prisma.Decimal(0);
export function sum(values: Iterable<Prisma.Decimal>) {
  let total = zero;
  for (const value of values) total = total.plus(value);
  return total;
}

type InvoiceBalanceInput = Pick<
  LedgerOrder['invoices'][number],
  'amount' | 'dueOn' | 'cancelledAt' | 'approvedAt'
> & {
  payments: Pick<
    LedgerOrder['invoices'][number]['payments'][number],
    'amount' | 'paidOn' | 'cancelledAt'
  >[];
};

export function invoiceBalance(
  invoice: InvoiceBalanceInput,
  today = new Date().toISOString().slice(0, 10),
) {
  const active = invoice.payments.filter((payment) => !payment.cancelledAt);
  const paid = sum(active.map((payment) => payment.amount));
  const remaining = invoice.amount.minus(paid);
  const overdue =
    !invoice.cancelledAt &&
    remaining.gt(0) &&
    !!invoice.dueOn &&
    invoice.dueOn.toISOString().slice(0, 10) < today;
  return {
    paid,
    remaining,
    overdue,
    lastPaymentOn: active.reduce<Date | null>(
      (last, payment) =>
        !last || payment.paidOn > last ? payment.paidOn : last,
      null,
    ),
    paymentStatus: invoice.cancelledAt
      ? 'CANCELLED'
      : remaining.eq(0)
        ? 'PAID'
        : paid.gt(0)
          ? 'PARTIALLY_PAID'
          : 'UNPAID',
    approvalStatus: invoice.cancelledAt
      ? 'CANCELLED'
      : invoice.approvedAt
        ? 'APPROVED'
        : 'DRAFT',
  };
}

type StockEvent = LedgerLine['fulfillmentEvents'][number];
export function quantityBalance(
  events: readonly Pick<StockEvent, 'kind' | 'quantity'>[],
) {
  const total = (kind: StockEvent['kind']) =>
    sum(
      events
        .filter((event) => event.kind === kind)
        .map((event) => event.quantity),
    );
  const received = total('RECEIPT');
  const returned = total('RETURN');
  const handedOver = total('HANDOVER');
  return { received, returned, accepted: received.minus(returned), handedOver };
}

export function shipmentItemBalance(
  line: LedgerOrder['shipments'][number]['items'][number],
) {
  return quantityBalance(line.events);
}

export function lineBalance(order: LedgerOrder, line: LedgerLine) {
  const dispatched = order.shipments.filter(
    (shipment) => shipment.shippedOn && !shipment.cancelledAt,
  );
  const shipped = sum(
    dispatched.flatMap((shipment) =>
      shipment.items
        .filter((item) => item.purchaseOrderItemId === line.id)
        .map((item) => item.quantity),
    ),
  );
  const balance = quantityBalance(line.fulfillmentEvents);
  return {
    ...balance,
    shipped,
    remaining: line.quantity.minus(balance.accepted),
  };
}

export function financialBalance(order: LedgerOrder) {
  const active = order.invoices.filter((invoice) => !invoice.cancelledAt);
  const billed = sum(active.map((invoice) => invoice.amount));
  const paid = sum(active.map((invoice) => invoiceBalance(invoice).paid));
  const settled =
    !!order.totalPrice?.gt(0) &&
    billed.eq(order.totalPrice) &&
    active.every(
      (invoice) =>
        invoice.approvedAt && invoiceBalance(invoice).remaining.eq(0),
    );
  return {
    billed,
    paid,
    unsettled: order.totalPrice?.minus(paid) ?? null,
    settled,
  };
}

export function openDiscrepancies(line: LedgerLine) {
  const resolved = new Set(
    line.fulfillmentEvents.map((event) => event.resolvesId),
  );
  return line.fulfillmentEvents.filter(
    (event) => event.kind === 'DISCREPANCY' && !resolved.has(event.id),
  );
}

export function orderBlockers(order: LedgerOrder): string[] {
  if (order.cancelledAt) return [];
  if (!order.ledgerEnabled) {
    return order.status === 'HANDED_OVER'
      ? []
      : ['Заказ прежнего формата ещё не передан получателю'];
  }
  const blockers = [];
  if (!financialBalance(order).settled)
    blockers.push('Есть неоплаченные или не выставленные обязательства');
  for (const item of order.items) {
    const balance = lineBalance(order, item);
    if (balance.remaining.gt(0))
      blockers.push(
        item.name +
          ': осталось получить ' +
          balance.remaining +
          ' ' +
          item.unit,
      );
    if (balance.handedOver.lt(item.quantity))
      blockers.push(
        item.name +
          ': осталось передать ' +
          item.quantity.minus(balance.handedOver) +
          ' ' +
          item.unit,
      );
    if (openDiscrepancies(item).length)
      blockers.push(item.name + ': есть незакрытые расхождения');
  }
  if (
    order.shipments.some(
      (shipment) =>
        !shipment.cancelledAt &&
        !shipment.shortClosedAt &&
        shipment.items.some((line) =>
          shipmentItemBalance(line).received.lt(line.quantity),
        ),
    )
  ) {
    blockers.push('Остались незавершённые партии');
  }
  return blockers;
}

export function assertFulfilledOrders(orders: LedgerOrder[]) {
  const blockers = orders.flatMap((order) =>
    orderBlockers(order).map((reason) => ({ orderId: order.id, reason })),
  );
  if (blockers.length)
    throw new ConflictException({
      message: blockers.map((blocker) => blocker.reason),
      blockers,
    });
}
