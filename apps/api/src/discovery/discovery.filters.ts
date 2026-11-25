import { BadRequestException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import {
  Prisma,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  TaskStatus,
} from '../generated/prisma/client.js';
import { dateRange, type Entity, type ListQuery } from './discovery.dto.js';

export const terminalTasks: TaskStatus[] = [
  TaskStatus.CLOSED,
  TaskStatus.CANCELLED,
];
export const pendingDelivery = [
  PurchaseOrderStatus.WAITING_SHIPMENT,
  PurchaseOrderStatus.IN_TRANSIT,
  PurchaseOrderStatus.READY_FOR_PICKUP,
];
export const statusLabels: Record<string, string> = {
  NEW: 'Новая',
  SEARCHING: 'Поиск поставщика',
  NEGOTIATION: 'Переговоры',
  ORDERED: 'Заказано',
  WAITING_PAYMENT: 'Ожидает оплаты',
  WAITING_SHIPMENT: 'Ожидает отгрузки',
  IN_TRANSIT: 'В пути',
  READY_FOR_PICKUP: 'Готово к получению',
  RECEIVED: 'Получено',
  HANDED_OVER: 'Передано',
  CLOSED: 'Закрыто',
  CANCELLED: 'Отменено',
  IN_REVIEW: 'В работе',
  NEEDS_CLARIFICATION: 'Требует уточнения',
  APPROVED: 'Принята',
  REJECTED: 'Отклонена',
  CONVERTED: 'Передана в закупку',
};
export const priorityLabels: Record<string, string> = {
  LOW: 'Низкий',
  NORMAL: 'Обычный',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};

export function requestScope(user: AuthUser): Prisma.PurchaseRequestWhereInput {
  return user.role === 'EMPLOYEE' ? { requesterId: user.id } : {};
}

export function contains(value: string) {
  return {
    contains: value.replace(/[\\%_]/g, '\\$&'),
    mode: Prisma.QueryMode.insensitive,
  };
}

function searchStatuses<T extends string>(values: T[], q: string): T[] {
  const term = q.toLocaleLowerCase('ru-RU');
  return values.filter(
    (value) =>
      value.toLowerCase().includes(term) ||
      statusLabels[value]?.toLocaleLowerCase('ru-RU').includes(term),
  );
}

function enumValue<T extends string>(
  values: T[],
  value?: string,
): T | undefined {
  if (value === undefined) return;
  const match = values.find((item) => item === value);
  if (!match) throw new BadRequestException('Некорректный статус');
  return match;
}

function created(q: Pick<ListQuery, 'createdFrom' | 'createdTo'>) {
  return dateRange(q.createdFrom, q.createdTo);
}

function planned(q: Pick<ListQuery, 'deadlineFrom' | 'deadlineTo'>) {
  return dateRange(q.deadlineFrom, q.deadlineTo);
}

// A purchase is overdue when its planned deadline is before the current instant.
export function overdueTasks(now: Date): Prisma.TaskWhereInput {
  return { deadline: { lt: now }, status: { notIn: terminalTasks } };
}

export const logisticsTasks = [
  TaskStatus.IN_TRANSIT,
  TaskStatus.READY_FOR_PICKUP,
];

export function attentionRules(now: Date): Prisma.TaskWhereInput[] {
  return [
    { deadline: { lt: now } },
    { reminderAt: { lte: now } },
    { priority: 'URGENT' },
    { status: 'READY_FOR_PICKUP' },
    { status: 'RECEIVED' },
    { status: 'HANDED_OVER' },
    { priority: 'HIGH' },
  ];
}

export function taskView(
  view: ListQuery['view'],
  now: Date,
): Prisma.TaskWhereInput {
  switch (view) {
    case 'active':
      return { status: { notIn: terminalTasks } };
    case 'attention':
      return { status: { notIn: terminalTasks }, OR: attentionRules(now) };
    case 'logistics':
      return { status: { in: logisticsTasks } };
    default:
      return {};
  }
}

export function tasksWhere(
  q: Pick<
    ListQuery,
    | 'q'
    | 'createdFrom'
    | 'createdTo'
    | 'deadlineFrom'
    | 'deadlineTo'
    | 'supplier'
    | 'status'
    | 'priority'
    | 'hasOrders'
    | 'overdue'
    | 'delivery'
    | 'payment'
    | 'view'
  >,
  now: Date,
  numbers: number[],
): Prisma.TaskWhereInput {
  const statuses = Object.values(TaskStatus);
  const order = orderFilter(q);
  const supplier = q.supplier
    ? { supplier: { name: contains(q.supplier) } }
    : undefined;
  const and: Prisma.TaskWhereInput[] = [taskView(q.view, now)];
  if (q.q) {
    const text = contains(q.q);
    and.push({
      OR: [
        { title: text },
        { description: text },
        { nextAction: text },
        { number: { in: numbers } },
        { status: { in: searchStatuses(statuses, q.q) } },
      ],
    });
  }
  if (q.overdue)
    and.push(
      q.overdue === 'true'
        ? overdueTasks(now)
        : {
            OR: [
              { deadline: null },
              { deadline: { gte: now } },
              { status: { in: terminalTasks } },
            ],
          },
    );
  if (q.hasOrders)
    and.push({
      purchaseOrders: q.hasOrders === 'true' ? { some: {} } : { none: {} },
    });
  if (q.payment || q.delivery)
    and.push({
      purchaseOrders: { some: { ...order, ...supplier } },
    });
  else if (supplier)
    and.push({
      OR: [
        { purchaseOrders: { some: supplier } },
        { supplierOffers: { some: supplier } },
      ],
    });
  return {
    AND: and,
    status: enumValue(statuses, q.status),
    priority: q.priority,
    createdAt: created(q),
    deadline: planned(q),
  };
}

export function requestsWhere(
  user: AuthUser,
  q: ListQuery,
  numbers: number[],
): Prisma.PurchaseRequestWhereInput {
  const statuses = Object.values(PurchaseRequestStatus);
  const text = q.q ? contains(q.q) : undefined;
  return {
    AND: [
      requestScope(user),
      {
        OR:
          text && q.q
            ? [
                { title: text },
                {
                  items: {
                    some: { OR: [{ name: text }, { partNumber: text }] },
                  },
                },
                { requesterName: text },
                { requester: { fullName: text } },
                { number: { in: numbers } },
                { status: { in: searchStatuses(statuses, q.q) } },
              ]
            : undefined,
        status: enumValue(statuses, q.status),
        priority: q.priority,
        createdAt: created(q),
        requiredAt: planned(q),
      },
    ],
  };
}

export function itemsWhere(
  q: ListQuery,
  now: Date,
  numbers: number[],
): Prisma.TaskItemWhereInput {
  const text = q.q ? contains(q.q) : undefined;
  return {
    OR: text
      ? [
          { name: text },
          { partNumber: text },
          { notes: text },
          { task: { title: text } },
          { task: { number: { in: numbers } } },
          { task: { purchaseOrders: { some: { supplier: { name: text } } } } },
          { task: { supplierOffers: { some: { supplier: { name: text } } } } },
        ]
      : undefined,
    createdAt: created(q),
    task: tasksWhere(
      {
        status: q.status,
        priority: q.priority,
        deadlineFrom: q.deadlineFrom,
        deadlineTo: q.deadlineTo,
        supplier: q.supplier,
        hasOrders: q.hasOrders,
        overdue: q.overdue,
        payment: q.payment,
        delivery: q.delivery,
      },
      now,
      [],
    ),
  };
}

export function suppliersWhere(q: ListQuery): Prisma.SupplierWhereInput {
  const text = q.q ? contains(q.q) : undefined;
  return {
    createdAt: created(q),
    OR: text
      ? [
          { name: text },
          { id: text },
          { contact: text },
          { phone: text },
          { email: text },
          { website: text },
        ]
      : undefined,
  };
}

function orderFilter(
  q: Pick<ListQuery, 'delivery' | 'payment'>,
): Prisma.PurchaseOrderWhereInput {
  const status = enumValue(Object.values(PurchaseOrderStatus), q.delivery);
  return {
    status,
    NOT: q.payment ? { status: PurchaseOrderStatus.CANCELLED } : undefined,
    paidAt:
      q.payment === 'paid'
        ? { not: null }
        : q.payment === 'unpaid'
          ? null
          : undefined,
  };
}

const awaitingArrival: PurchaseOrderStatus[] = [
  'ORDERED',
  'WAITING_PAYMENT',
  'WAITING_SHIPMENT',
  'IN_TRANSIT',
];

export function overdueOrders(now: Date): Prisma.PurchaseOrderWhereInput {
  return {
    status: { in: awaitingArrival },
    receivedAt: null,
    expectedDeliveryAt: { lt: now },
  };
}

export function ordersWhere(
  q: ListQuery,
  numbers: number[],
  now: Date,
): Prisma.PurchaseOrderWhereInput {
  const statuses = Object.values(PurchaseOrderStatus);
  const text = q.q ? contains(q.q) : undefined;
  return {
    AND: [
      orderFilter(q),
      ...(q.overdue
        ? [
            q.overdue === 'true'
              ? overdueOrders(now)
              : {
                  OR: [
                    { expectedDeliveryAt: null },
                    { expectedDeliveryAt: { gte: now } },
                    { receivedAt: { not: null } },
                    { status: { notIn: awaitingArrival } },
                  ],
                },
          ]
        : []),
      {
        status: enumValue(statuses, q.status),
        createdAt: created(q),
        expectedDeliveryAt: planned(q),
        supplierId: q.supplierId,
        supplier: q.supplier ? { name: contains(q.supplier) } : undefined,
        OR:
          text && q.q
            ? [
                { id: text },
                { invoiceNumber: text },
                { trackingNumber: text },
                { supplier: { name: text } },
                { task: { title: text } },
                { task: { number: { in: numbers } } },
                { status: { in: searchStatuses(statuses, q.q) } },
              ]
            : undefined,
      },
    ],
  };
}

const baseFilters = ['createdFrom', 'createdTo'] as const;
const taskFilters = [
  'status',
  'priority',
  'deadlineFrom',
  'deadlineTo',
  'supplier',
  'hasOrders',
  'overdue',
  'payment',
  'delivery',
] as const;
const allowedFilters: Record<Entity, readonly (keyof ListQuery)[]> = {
  tasks: [...baseFilters, ...taskFilters, 'view'],
  items: [...baseFilters, ...taskFilters],
  suppliers: baseFilters,
  orders: [
    ...baseFilters,
    'status',
    'deadlineFrom',
    'deadlineTo',
    'supplier',
    'supplierId',
    'overdue',
    'payment',
    'delivery',
  ],
  requests: [
    ...baseFilters,
    'status',
    'priority',
    'deadlineFrom',
    'deadlineTo',
  ],
};

export function validateFilters(entity: Entity, q: ListQuery) {
  for (const key of new Set(Object.values(allowedFilters).flat())) {
    if (q[key] !== undefined && !allowedFilters[entity].includes(key)) {
      throw new BadRequestException(
        `Фильтр ${key} недоступен для этой выборки`,
      );
    }
  }
}
