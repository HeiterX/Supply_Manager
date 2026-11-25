import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  PurchaseOrderStatus,
  TaskStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  dateRange,
  reportTimeZone,
  type ReportQuery,
} from './discovery.dto.js';
import {
  overdueOrders,
  overdueTasks,
  pendingDelivery,
  statusLabels,
  terminalTasks,
} from './discovery.filters.js';
import { decimal, type Cell } from './discovery.selections.js';

const day = 86400000;
const date = new Intl.DateTimeFormat('sv-SE', {
  timeZone: reportTimeZone,
  dateStyle: 'short',
});
const detailLimit = 25;
const finishedDelivery = [
  PurchaseOrderStatus.RECEIVED,
  PurchaseOrderStatus.HANDED_OVER,
];

export const unavailableReports = [
  'Ответственные и загрузка снабженцев: в закупке пока нет назначения ответственного.',
  'Сроки, просрочки и закрытие действий: ожидается серверная модель Next Action.',
  'Частичные и просроченные оплаты: пока нет транзакций и сроков оплаты.',
  'Частичная приёмка и количества полученных комплектующих: пока нет журнала приёмки.',
] as const;

export function reportPeriod(q: ReportQuery, now: Date) {
  const to = q.to ?? date.format(now);
  const end = dateRange(undefined, to)!.lt!;
  const from = q.from ?? date.format(new Date(end.getTime() - 90 * day));
  const range = dateRange(from, to)!;
  const start = range.gte!;
  if (end.getTime() - start.getTime() > 366 * day) {
    throw new BadRequestException('Период отчёта не должен превышать 366 дней');
  }
  return { from, to, start, end };
}

type Monthly = {
  month: string;
  created: number;
  closed: number;
  invoices: string;
  paid: string;
  unknownAmounts: number;
};
type SupplierMetric = {
  id: string;
  name: string;
  orders: number;
  value: string;
  received: number;
  assessed: number;
  late: number;
  missingAmounts: number;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(q: ReportQuery, now = new Date()) {
    const { from, to, start, end } = reportPeriod(q, now);
    const period = { gte: start, lt: end };
    return this.prisma.$transaction(
      async (db) => {
        const taskStatuses = await db.task.groupBy({
          by: ['status'],
          _count: { _all: true },
        });
        const deliveryStatuses = await db.purchaseOrder.groupBy({
          by: ['status'],
          where: { orderedAt: period },
          _count: { _all: true },
        });
        const requests = await db.purchaseRequest.count({
          where: { createdAt: period },
        });
        const awaitingDelivery = await db.task.count({
          where: {
            status: { notIn: terminalTasks },
            purchaseOrders: { some: { status: { in: pendingDelivery } } },
          },
        });
        const overdueWhere = overdueTasks(now);
        const overdue = await db.task.count({ where: overdueWhere });
        const overduePurchases = await db.task.findMany({
          where: overdueWhere,
          orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
          take: detailLimit,
          select: { id: true, number: true, title: true, deadline: true },
        });
        const lateOrders = await db.purchaseOrder.count({
          where: {
            ...overdueOrders(now),
            orderedAt: period,
          },
        });
        const received = await db.purchaseOrder.count({
          where: { status: { in: finishedDelivery }, receivedAt: period },
        });
        const invoices = await db.purchaseOrder.aggregate({
          where: { invoiceDate: period, status: { not: 'CANCELLED' } },
          _count: { _all: true, totalPrice: true },
          _sum: { totalPrice: true },
        });
        const confirmed = await db.purchaseOrder.aggregate({
          where: { paidAt: period, status: { not: 'CANCELLED' } },
          _count: { _all: true, totalPrice: true },
          _sum: { totalPrice: true },
        });
        const outstanding = await db.purchaseOrder.aggregate({
          where: {
            invoiceDate: period,
            paidAt: null,
            status: { not: 'CANCELLED' },
          },
          _sum: { totalPrice: true },
        });

        const schema =
          new URL(process.env.DATABASE_URL!).searchParams.get('schema') ??
          'public';
        const table = (name: 'Task' | 'PurchaseOrder' | 'Supplier') =>
          Prisma.raw(`"${schema.replace(/"/g, '""')}"."${name}"`);
        const utc = (instant: Date) =>
          Prisma.sql`(${instant.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
        const startUtc = utc(start);
        const endUtc = utc(end);
        const monthly = await db.$queryRaw<Monthly[]>`
        WITH events AS (
          SELECT "createdAt" AS stamp, 1 AS created, 0 AS closed, 0::numeric AS invoice, 0::numeric AS paid, 0 AS unknown
          FROM ${table('Task')} WHERE "createdAt" >= ${startUtc} AND "createdAt" < ${endUtc}
          UNION ALL
          SELECT "closedAt", 0, 1, 0, 0, 0
          FROM ${table('Task')} WHERE status = 'CLOSED' AND "closedAt" >= ${startUtc} AND "closedAt" < ${endUtc}
          UNION ALL
          SELECT "invoiceDate", 0, 0, "totalPrice", 0, ("totalPrice" IS NULL)::int
          FROM ${table('PurchaseOrder')} WHERE status <> 'CANCELLED' AND "invoiceDate" >= ${startUtc} AND "invoiceDate" < ${endUtc}
          UNION ALL
          SELECT "paidAt", 0, 0, 0, "totalPrice", ("totalPrice" IS NULL)::int
          FROM ${table('PurchaseOrder')} WHERE status <> 'CANCELLED' AND "paidAt" >= ${startUtc} AND "paidAt" < ${endUtc}
        )
        SELECT to_char(stamp AT TIME ZONE 'UTC' AT TIME ZONE ${reportTimeZone}, 'YYYY-MM') AS month,
               sum(created)::int AS created, sum(closed)::int AS closed,
               coalesce(sum(invoice), 0)::text AS invoices, coalesce(sum(paid), 0)::text AS paid,
               sum(unknown)::int AS "unknownAmounts"
        FROM events GROUP BY 1 ORDER BY 1
      `;
        const suppliers = await db.$queryRaw<SupplierMetric[]>`
        WITH totals AS (
          SELECT "supplierId",
                 count(*)::int AS orders,
                 coalesce(sum("totalPrice"), 0)::text AS value,
                 count(*) FILTER (WHERE "totalPrice" IS NULL)::int AS "missingAmounts",
                 count(*) FILTER (WHERE status IN ('RECEIVED', 'HANDED_OVER') AND "receivedAt" IS NOT NULL)::int AS received,
                 count(*) FILTER (WHERE status IN ('RECEIVED', 'HANDED_OVER')
                   AND "receivedAt" IS NOT NULL AND "expectedDeliveryAt" IS NOT NULL)::int AS assessed,
                 count(*) FILTER (WHERE status IN ('RECEIVED', 'HANDED_OVER')
                   AND coalesce("readyForPickupAt", "receivedAt") > "expectedDeliveryAt")::int AS late
          FROM ${table('PurchaseOrder')}
          WHERE status <> 'CANCELLED' AND "orderedAt" >= ${startUtc} AND "orderedAt" < ${endUtc}
          GROUP BY "supplierId" ORDER BY orders DESC, "supplierId" LIMIT ${detailLimit}
        )
        SELECT s.id, s.name, totals.orders, totals.value, totals.received, totals.assessed, totals.late, totals."missingAmounts"
        FROM totals JOIN ${table('Supplier')} s ON s.id = totals."supplierId"
        ORDER BY totals.orders DESC, s.id
      `;
        const active = taskStatuses.reduce(
          (sum, row) =>
            sum + (terminalTasks.includes(row.status) ? 0 : row._count._all),
          0,
        );
        const completed =
          taskStatuses.find((row) => row.status === TaskStatus.CLOSED)?._count
            ._all ?? 0;
        const orders = deliveryStatuses.reduce(
          (sum, row) => sum + row._count._all,
          0,
        );
        const invoiced = invoices._sum.totalPrice ?? new Prisma.Decimal(0);
        return {
          from,
          to,
          timeZone: reportTimeZone,
          generatedAt: now,
          snapshot: { active, completed, overdue, awaitingDelivery },
          period: { requests, orders, received, overdueOrders: lateOrders },
          taskStatuses: taskStatuses.map((row) => ({
            status: row.status,
            count: row._count._all,
          })),
          deliveryStatuses: deliveryStatuses.map((row) => ({
            status: row.status,
            count: row._count._all,
          })),
          payments: {
            currency: 'RUB',
            invoiced: invoiced.toFixed(2),
            paid: confirmed._sum.totalPrice?.toFixed(2) ?? '0.00',
            missingPaymentAmounts:
              confirmed._count._all - confirmed._count.totalPrice,
            outstanding: outstanding._sum.totalPrice?.toFixed(2) ?? '0.00',
            missingInvoiceAmounts:
              invoices._count._all - invoices._count.totalPrice,
          },
          monthly,
          suppliers,
          overduePurchases,
          detailLimit,
          unavailable: unavailableReports,
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: 10000 },
    );
  }

  async export(q: ReportQuery) {
    const report = await this.report(q);
    const { snapshot, period, payments } = report;
    const rows: Cell[][] = [
      ['Отчёт', 'Начало периода', report.from],
      ['Отчёт', 'Конец периода', report.to],
      ['Отчёт', 'Часовой пояс', report.timeZone],
      ['Отчёт', 'Сформирован', report.generatedAt],
      ['На момент запроса', 'Активные закупки', snapshot.active],
      ['На момент запроса', 'Завершённые закупки', snapshot.completed],
      ['На момент запроса', 'Просроченные закупки', snapshot.overdue],
      [
        'На момент запроса',
        'Закупки в ожидании поставки',
        snapshot.awaitingDelivery,
      ],
      ['За период', 'Заявки', period.requests],
      ['За период', 'Оформленные заказы', period.orders],
      ['За период', 'Полученные заказы', period.received],
      [
        'За период',
        'Оформленные заказы с просроченным прибытием',
        period.overdueOrders,
      ],
      [
        'Оплаты',
        'Сумма заказов со счётом',
        decimal(payments.invoiced),
        payments.currency,
      ],
      [
        'Оплаты',
        'Сумма оплаченных заказов',
        decimal(payments.paid),
        payments.currency,
      ],
      [
        'Оплаты',
        'Сумма неоплаченных заказов со счётом',
        decimal(payments.outstanding),
        payments.currency,
      ],
      ['Оплаты', 'Счета без суммы', payments.missingInvoiceAmounts],
      [
        'Оплаты',
        'Подтверждённые оплаты без суммы',
        payments.missingPaymentAmounts,
      ],
    ];
    for (const row of report.taskStatuses)
      rows.push(['Статусы закупок', statusLabels[row.status], row.count]);
    for (const row of report.deliveryStatuses)
      rows.push(['Статусы заказов', statusLabels[row.status], row.count]);
    for (const row of report.monthly) {
      rows.push(
        ['Создано закупок', row.month, row.created],
        ['Закрыто закупок', row.month, row.closed],
        [
          'Сумма заказов со счётом',
          row.month,
          decimal(row.invoices),
          payments.currency,
        ],
        [
          'Сумма оплаченных заказов',
          row.month,
          decimal(row.paid),
          payments.currency,
        ],
        ['События без суммы', row.month, row.unknownAmounts],
      );
    }
    for (const row of report.suppliers) {
      rows.push(
        ['Заказы поставщика', row.name, row.orders],
        [
          'Сумма заказов поставщика',
          row.name,
          decimal(row.value),
          payments.currency,
        ],
        ['Полученные заказы поставщика', row.name, row.received],
        ['Просроченные из полученных', row.name, row.late, null, row.assessed],
        ['Заказы поставщика без суммы', row.name, row.missingAmounts],
      );
    }
    for (const row of report.overduePurchases)
      rows.push([
        'Плановый срок закупки',
        `№ ${row.number} · ${row.title}`,
        row.deadline,
      ]);
    for (const reason of report.unavailable) rows.push(['Недоступно', reason]);
    return {
      headings: [
        'Раздел',
        'Показатель / объект',
        'Значение',
        'Валюта',
        'Оценено поставок',
      ],
      rows,
    };
  }
}
