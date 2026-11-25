'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, type ReactNode } from 'react';
import { formatDecimal, formatReportDate, statusLabels, taskLink, useCoreResource } from '@/lib/discovery';
import PageLayout from '@/app/components/PageLayout';
import { buttonClass, ExportButtons, fieldClass } from '@/app/components/DiscoveryControls';

type Status = { status: string; count: number };
type Monthly = { month: string; created: number; closed: number; invoices: string; paid: string; unknownAmounts: number };
type Supplier = { id: string; name: string; orders: number; value: string; received: number; assessed: number; late: number; missingAmounts: number };
type Report = {
  from: string; to: string; timeZone: string; generatedAt: string;
  snapshot: { active: number; completed: number; overdue: number; awaitingDelivery: number };
  period: { requests: number; orders: number; received: number; overdueOrders: number };
  taskStatuses: Status[]; deliveryStatuses: Status[];
  payments: { currency: string; invoiced: string; paid: string; outstanding: string; missingInvoiceAmounts: number; missingPaymentAmounts: number };
  monthly: Monthly[]; suppliers: Supplier[];
  overduePurchases: { id: string; number: number; title: string; deadline: string }[];
  detailLimit: number; unavailable: string[];
};

const panelClass = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5';
const headingClass = 'text-lg font-semibold text-slate-950';
const columnClass = 'px-3 py-2 text-left align-top';
const formattedPeriod = (from: string, to: string) =>
  `${from.split('-').reverse().join('.')} — ${to.split('-').reverse().join('.')}`;

function Panel({ title, period, children }: { title: string; period?: string; children: ReactNode }) {
  return (
    <section className={panelClass}>
      <h2 className={headingClass}>{title}</h2>
      {period && <p className="mt-1 text-xs text-slate-600">{period}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Metrics({ items }: { items: [string, number | string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-xl bg-slate-50 p-3">
          <dt className="text-xs font-medium text-slate-600">{label}</dt>
          <dd className="mt-1 break-words text-xl font-semibold tabular-nums sm:text-2xl">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Bars({ rows }: { rows: Status[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-600">За этот период нет записей.</p>;
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <ul className="space-y-3">
      {rows.map(({ status, count }) => (
        <li key={status} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-4 gap-y-1 text-sm">
          <span>{statusLabels[status] ?? status}</span>
          <span className="text-right font-medium tabular-nums">{count}</span>
          <div aria-hidden="true" className="col-span-2 h-1.5 rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${count / max * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MonthlyTable({ rows, currency }: { rows: Monthly[]; currency: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-600">За этот период нет событий.</p>;
  return (
    <div className="overflow-x-auto" role="region" aria-label="Таблица по месяцам" tabIndex={0}>
      <table className="w-full min-w-[33rem] text-sm">
        <thead className="bg-slate-50 text-slate-700"><tr>
          {['Месяц', 'Создано закупок', 'Закрыто закупок', `Со счётом, ${currency}`, `Оплачено, ${currency}`, 'Событий без суммы'].map((title) =>
            <th className={columnClass} key={title} scope="col">{title}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.month} className="tabular-nums">
              <th scope="row" className={columnClass}>{row.month}</th>
              <td className={columnClass}>{row.created}</td><td className={columnClass}>{row.closed}</td>
              <td className={columnClass}>{formatDecimal(row.invoices)}</td><td className={columnClass}>{formatDecimal(row.paid)}</td>
              <td className={columnClass}>{row.unknownAmounts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupplierTable({ rows, currency }: { rows: Supplier[]; currency: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-600">За этот период нет заказов поставщикам.</p>;
  return (
    <div className="overflow-x-auto" role="region" aria-label="Таблица поставщиков" tabIndex={0}>
      <table className="w-full min-w-[35rem] text-sm">
        <thead className="bg-slate-50 text-slate-700"><tr>
          {['Поставщик', 'Заказов', `Сумма, ${currency}`, 'Получено', 'Получено с опозданием', 'Заказов без суммы'].map((title) =>
            <th className={columnClass} key={title} scope="col">{title}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className="tabular-nums">
              <th scope="row" className={columnClass}>
                <Link className="break-words text-blue-700 hover:underline" href={`/suppliers/${row.id}`}>{row.name}</Link>
              </th>
              <td className={columnClass}>{row.orders}</td><td className={columnClass}>{formatDecimal(row.value)}</td>
              <td className={columnClass}>{row.received}</td>
              <td className={columnClass}>{row.assessed ? `${row.late} из ${row.assessed} (${Math.round(row.late / row.assessed * 100)}%)` : '—'}</td>
              <td className={columnClass}>{row.missingAmounts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsContent() {
  const params = useSearchParams();
  const query = new URLSearchParams(params);
  const { data, loading, error, reload } = useCoreResource<Report>(`/discovery/analytics?${query}`);
  const period = data ? formattedPeriod(data.from, data.to) : '';
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string' && value) next.set(key, value);
    }
    window.history.pushState(null, '', next.size ? `/analytics?${next}` : '/analytics');
  }
  return (
    <PageLayout title="Аналитика">
      <div className="space-y-5">
        <section className={panelClass}>
          <form key={query.toString()} onSubmit={apply} className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-600">Начало периода
              <input type="date" className={fieldClass} name="from" defaultValue={query.get('from') ?? ''} />
            </label>
            <label className="text-xs font-medium text-slate-600">Конец периода
              <input type="date" className={fieldClass} name="to" defaultValue={query.get('to') ?? ''} />
            </label>
            <button className={buttonClass} type="submit">Применить</button>
            <button className={buttonClass} type="reset" onClick={() => window.history.pushState(null, '', '/analytics')}>Сбросить</button>
          </form>
          {data && <p className="my-3 text-sm text-slate-600">{period} · {data.timeZone}</p>}
          <ExportButtons key={query.toString()} url={`/discovery/analytics/export?${query}`} name="analytics" />
        </section>
        {loading && <p role="status" className={panelClass}>Формируем отчёт…</p>}
        {error && <div role="alert" className={panelClass}><p className="mb-2 text-rose-700">{error}</p><button type="button" className={buttonClass} onClick={() => void reload()}>Повторить</button></div>}
        {data && (
          <>
            <Panel title="Закупки на момент отчёта" period={formatReportDate(data.generatedAt)}>
              <Metrics items={[
                ['Активные', data.snapshot.active], ['Закрытые', data.snapshot.completed],
                ['Просроченные', data.snapshot.overdue], ['Ожидают поставки', data.snapshot.awaitingDelivery],
              ]} />
            </Panel>
            <Panel title="Заявки и заказы" period={period}>
              <Metrics items={[
                ['Поступило заявок', data.period.requests], ['Оформлено заказов', data.period.orders],
                ['Получено заказов', data.period.received], ['Просрочено среди оформленных', data.period.overdueOrders],
              ]} />
            </Panel>
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Статусы закупок" period={`На ${formatReportDate(data.generatedAt)}`}><Bars rows={data.taskStatuses} /></Panel>
              <Panel title="Статусы заказов, оформленных за период" period={period}><Bars rows={data.deliveryStatuses} /></Panel>
            </div>
            <Panel title="Оплаты" period={period}>
              <Metrics items={[
                ['Заказы со счётом', formatDecimal(data.payments.invoiced, data.payments.currency)],
                ['Подтверждённые оплаты', formatDecimal(data.payments.paid, data.payments.currency)],
                ['Заказы со счётом без оплаты', formatDecimal(data.payments.outstanding, data.payments.currency)],
                ['Счета без суммы', data.payments.missingInvoiceAmounts],
                ['Подтверждённые оплаты без суммы', data.payments.missingPaymentAmounts],
              ]} />
            </Panel>
            <Panel title="Динамика закупок и оплат по месяцам" period={period}>
              <MonthlyTable rows={data.monthly} currency={data.payments.currency} />
            </Panel>
            <Panel title="Поставщики по числу заказов" period={`${period} · до ${data.detailLimit} поставщиков`}>
              <SupplierTable rows={data.suppliers} currency={data.payments.currency} />
            </Panel>
            <Panel title="Закупки с просроченным плановым сроком" period={`На ${formatReportDate(data.generatedAt)} · до ${data.detailLimit} закупок`}>
              {data.overduePurchases.length ? (
                <ul className="divide-y divide-slate-100">
                  {data.overduePurchases.map((task) => (
                    <li key={task.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                      <Link href={taskLink(task.id, '/analytics', query)} className="min-w-0 break-words font-semibold text-blue-700 hover:underline">№ {task.number} · {task.title}</Link>
                      <span>{formatReportDate(task.deadline)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-600">Просроченных закупок нет.</p>}
            </Panel>
            <Panel title="Пока недоступно">
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                {data.unavailable.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </Panel>
          </>
        )}
      </div>
    </PageLayout>
  );
}

export default function AnalyticsPage() {
  return <Suspense><AnalyticsContent /></Suspense>;
}
