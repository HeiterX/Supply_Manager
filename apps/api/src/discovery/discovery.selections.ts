import { BadRequestException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Entity, ListQuery, Sort } from './discovery.dto.js';
import {
  itemsWhere,
  ordersWhere,
  priorityLabels,
  requestsWhere,
  statusLabels,
  suppliersWhere,
  tasksWhere,
  validateFilters,
} from './discovery.filters.js';

const taskSummary = {
  id: true,
  number: true,
  title: true,
  status: true,
} as const;
const supplierSummary = { id: true, name: true } as const;
const userSummary = { id: true, fullName: true } as const;
const supplierLink = {
  select: { supplier: { select: supplierSummary } },
} as const;

export const taskSelect = {
  ...taskSummary,
  description: true,
  priority: true,
  deadline: true,
  nextAction: true,
  reminderAt: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.TaskSelect;
const itemSelect = {
  id: true,
  name: true,
  partNumber: true,
  quantity: true,
  unit: true,
  unitPrice: true,
  currency: true,
  createdAt: true,
  task: {
    select: {
      ...taskSummary,
      priority: true,
      deadline: true,
      nextAction: true,
      selectedOffer: supplierLink,
      purchaseOrder: supplierLink,
    },
  },
} satisfies Prisma.TaskItemSelect;
const supplierSelect = {
  ...supplierSummary,
  contact: true,
  phone: true,
  email: true,
  website: true,
  createdAt: true,
} satisfies Prisma.SupplierSelect;
const orderSelect = {
  id: true,
  status: true,
  invoiceNumber: true,
  totalPrice: true,
  orderedAt: true,
  trackingNumber: true,
  paidAt: true,
  expectedDeliveryAt: true,
  receivedAt: true,
  createdAt: true,
  task: { select: taskSummary },
  supplier: { select: supplierSummary },
} satisfies Prisma.PurchaseOrderSelect;
const requestSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  requiredAt: true,
  createdAt: true,
  notes: true,
  requesterName: true,
  requester: { select: userSummary },
  _count: { select: { items: true } },
} satisfies Prisma.PurchaseRequestSelect;

export type SearchHit = {
  entity: Entity;
  id: string;
  title: string;
  reference: string | null;
  href: string;
};
type DecimalCell = { decimal: string };
export type Cell = string | number | Date | DecimalCell | null;

export function decimal(value: string | null | undefined): DecimalCell | null {
  return value == null ? null : { decimal: value };
}
type Slice = { skip?: number; take: number };

function selection<T extends { id: string }>(
  count: () => Promise<number>,
  rows: (slice: Slice) => Promise<T[]>,
  hit: (row: T) => SearchHit,
  headings: string[],
  cells: (row: T) => Cell[],
) {
  return {
    count,
    rows,
    headings,
    hits: async (slice: Slice) => (await rows(slice)).map(hit),
    exportRows: async (slice: Slice) => (await rows(slice)).map(cells),
  };
}

function orderBy<T>(
  q: ListQuery,
  fields: Partial<Record<Sort, (dir: 'asc' | 'desc') => T>>,
  idOrder: T,
) {
  const field = fields[q.sort ?? 'createdAt'];
  if (!field) throw new BadRequestException('Недопустимое поле сортировки');
  return [field(q.direction ?? 'desc'), idOrder];
}

export function makeSelection(
  db: Prisma.TransactionClient,
  entity: Entity,
  user: AuthUser,
  q: ListQuery,
  now: Date,
  numbers: number[],
) {
  validateFilters(entity, q);
  switch (entity) {
    case 'tasks': {
      const where = tasksWhere(q, now, numbers);
      const order = orderBy<Prisma.TaskOrderByWithRelationInput>(
        q,
        {
          createdAt: (dir) => ({ createdAt: dir }),
          deadline: (dir) => ({ deadline: { sort: dir, nulls: 'last' } }),
          priority: (dir) => ({ priority: dir }),
          status: (dir) => ({ status: dir }),
          number: (dir) => ({ number: dir }),
          name: (dir) => ({ title: dir }),
        },
        { id: 'asc' },
      );
      return selection(
        () => db.task.count({ where }),
        (slice) =>
          db.task.findMany({
            ...slice,
            where,
            orderBy: order,
            select: taskSelect,
          }),
        (row) => ({
          entity,
          id: row.id,
          title: row.title,
          reference: String(row.number),
          href: `/tasks/${row.id}`,
        }),
        [
          'Номер закупки',
          'Наименование',
          'Статус',
          'Приоритет',
          'Создана',
          'Плановый срок',
          'Закрыта',
          'Позиций',
        ],
        (row) => [
          row.number,
          row.title,
          statusLabels[row.status],
          priorityLabels[row.priority],
          row.createdAt,
          row.deadline,
          row.closedAt,
          row._count.items,
        ],
      );
    }
    case 'items': {
      const where = itemsWhere(q, now, numbers);
      const order = orderBy<Prisma.TaskItemOrderByWithRelationInput>(
        q,
        {
          createdAt: (dir) => ({ createdAt: dir }),
          name: (dir) => ({ name: dir }),
          status: (dir) => ({ task: { status: dir } }),
          priority: (dir) => ({ task: { priority: dir } }),
          deadline: (dir) => ({
            task: { deadline: { sort: dir, nulls: 'last' } },
          }),
          number: (dir) => ({ task: { number: dir } }),
        },
        { id: 'asc' },
      );
      return selection(
        () => db.taskItem.count({ where }),
        (slice) =>
          db.taskItem.findMany({
            ...slice,
            where,
            orderBy: order,
            select: itemSelect,
          }),
        (row) => ({
          entity,
          id: row.id,
          title: row.name,
          reference: row.partNumber,
          href: `/tasks/${row.task.id}?tab=items#items-${row.id}`,
        }),
        [
          'Позиция',
          'Артикул',
          'Количество',
          'Единица',
          'Цена за единицу',
          'Валюта',
          'Номер закупки',
          'Закупка',
          'Создана',
        ],
        (row) => [
          row.name,
          row.partNumber,
          decimal(row.quantity.toString()),
          row.unit,
          decimal(row.unitPrice?.toFixed(2)),
          row.currency,
          row.task.number,
          row.task.title,
          row.createdAt,
        ],
      );
    }
    case 'suppliers': {
      const where = suppliersWhere(q);
      const order = orderBy<Prisma.SupplierOrderByWithRelationInput>(
        q,
        {
          createdAt: (dir) => ({ createdAt: dir }),
          name: (dir) => ({ name: dir }),
        },
        { id: 'asc' },
      );
      return selection(
        () => db.supplier.count({ where }),
        (slice) =>
          db.supplier.findMany({
            ...slice,
            where,
            orderBy: order,
            select: supplierSelect,
          }),
        (row) => ({
          entity,
          id: row.id,
          title: row.name,
          reference: null,
          href: `/suppliers/${row.id}`,
        }),
        [
          'Поставщик',
          'Контакт',
          'Телефон',
          'Электронная почта',
          'Сайт',
          'Создан',
        ],
        (row) => [
          row.name,
          row.contact,
          row.phone,
          row.email,
          row.website,
          row.createdAt,
        ],
      );
    }
    case 'orders': {
      const where = ordersWhere(q, numbers, now);
      const order = orderBy<Prisma.PurchaseOrderOrderByWithRelationInput>(
        q,
        {
          createdAt: (dir) => ({ createdAt: dir }),
          status: (dir) => ({ status: dir }),
          deadline: (dir) => ({
            expectedDeliveryAt: { sort: dir, nulls: 'last' },
          }),
          number: (dir) => ({ invoiceNumber: { sort: dir, nulls: 'last' } }),
          name: (dir) => ({ supplier: { name: dir } }),
        },
        { id: 'asc' },
      );
      return selection(
        () => db.purchaseOrder.count({ where }),
        (slice) =>
          db.purchaseOrder.findMany({
            ...slice,
            where,
            orderBy: order,
            select: orderSelect,
          }),
        (row) => ({
          entity,
          id: row.id,
          title: `${row.supplier.name} · ${row.task.title}`,
          reference: row.invoiceNumber ?? row.id,
          href: `/tasks/${row.task.id}?tab=order#order-${row.id}`,
        }),
        [
          'ID заказа',
          'Номер счёта',
          'Закупка',
          'Поставщик',
          'Статус',
          'Сумма заказа',
          'Валюта',
          'Оформлен',
          'Оплачен',
          'Плановая доставка',
          'Получен',
        ],
        (row) => [
          row.id,
          row.invoiceNumber,
          row.task.number,
          row.supplier.name,
          statusLabels[row.status],
          decimal(row.totalPrice?.toFixed(2)),
          'RUB',
          row.orderedAt,
          row.paidAt,
          row.expectedDeliveryAt,
          row.receivedAt,
        ],
      );
    }
    case 'requests': {
      const where = requestsWhere(user, q, numbers);
      const order = orderBy<Prisma.PurchaseRequestOrderByWithRelationInput>(
        q,
        {
          createdAt: (dir) => ({ createdAt: dir }),
          deadline: (dir) => ({ requiredAt: { sort: dir, nulls: 'last' } }),
          priority: (dir) => ({ priority: dir }),
          status: (dir) => ({ status: dir }),
          number: (dir) => ({ number: dir }),
          name: (dir) => ({ title: dir }),
        },
        { id: 'asc' },
      );
      return selection(
        () => db.purchaseRequest.count({ where }),
        (slice) =>
          db.purchaseRequest.findMany({
            ...slice,
            where,
            orderBy: order,
            select: requestSelect,
          }),
        (row) => ({
          entity,
          id: row.id,
          title: row.title,
          reference: String(row.number),
          href: `/requests/${row.id}`,
        }),
        [
          'Номер заявки',
          'Наименование',
          'Инициатор',
          'Статус',
          'Приоритет',
          'Создана',
          'Требуется к',
          'Позиций',
        ],
        (row) => [
          row.number,
          row.title,
          row.requester?.fullName ?? row.requesterName,
          row.status,
          row.priority,
          row.createdAt,
          row.requiredAt,
          row._count.items,
        ],
      );
    }
  }
}

export async function matchingNumbers(
  db: Prisma.TransactionClient,
  user: AuthUser,
  query: string | undefined,
  entity?: Entity,
) {
  const digits = query?.match(/^#?([0-9]{1,10})$/)?.[1];
  if (!digits) return { tasks: [], requests: [] };
  const schema =
    new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? 'public';
  const table = (name: 'Task' | 'PurchaseRequest') =>
    Prisma.raw(`"${schema.replace(/"/g, '""')}"."${name}"`);
  const pattern = `%${digits}%`;
  const limit = 10001;
  const ownRequests =
    user.role === 'EMPLOYEE'
      ? Prisma.sql`AND "requesterId" = ${user.id}`
      : Prisma.empty;
  const tasks =
    user.role !== 'EMPLOYEE' &&
    (!entity || ['tasks', 'items', 'orders'].includes(entity))
      ? await db.$queryRaw<
          { number: number }[]
        >`SELECT number FROM ${table('Task')} WHERE number::text LIKE ${pattern} LIMIT ${limit}`
      : [];
  const requests =
    !entity || entity === 'requests'
      ? await db.$queryRaw<
          { number: number }[]
        >`SELECT number FROM ${table('PurchaseRequest')} WHERE number::text LIKE ${pattern} ${ownRequests} LIMIT ${limit}`
      : [];
  if (tasks.length === limit || requests.length === limit) {
    throw new BadRequestException(
      'Слишком много совпадающих номеров. Уточните запрос',
    );
  }
  return {
    tasks: tasks.map((row) => row.number),
    requests: requests.map((row) => row.number),
  };
}
