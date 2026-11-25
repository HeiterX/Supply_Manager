'use client';

import { useState, type FormEvent } from 'react';
import {
  downloadReport, priorityLabels, statusLabels, type Entity, type Format, type Page,
} from '../../lib/discovery';

export const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
export const buttonClass = 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-45';
const taskStatuses = ['NEW', 'SEARCHING', 'NEGOTIATION', 'ORDERED', 'WAITING_PAYMENT', 'WAITING_SHIPMENT', 'IN_TRANSIT', 'READY_FOR_PICKUP', 'RECEIVED', 'HANDED_OVER', 'CLOSED', 'CANCELLED'];
const orderStatuses = taskStatuses.filter((status) => !['NEW', 'SEARCHING', 'NEGOTIATION', 'CLOSED'].includes(status));
const requestStatuses = ['NEW', 'IN_REVIEW', 'NEEDS_CLARIFICATION', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'];
const statusOptions = (values: string[]) => values.map((value) => [value, statusLabels[value]] as const);

export function ExportButtons({ url, name }: { url: `/${string}`; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download(format: Format) {
    setBusy(true);
    setError('');
    try {
      await downloadReport(url, format, name);
    } catch (error) {
      setError(error instanceof TypeError ? 'Сервер недоступен. Повторите попытку.' :
        error instanceof Error ? error.message : 'Не удалось выгрузить данные.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(['csv', 'xlsx'] as const).map((format) => (
        <button key={format} type="button" className={buttonClass} disabled={busy}
          onClick={() => void download(format)}>Скачать {format.toUpperCase()}</button>
      ))}
      {busy && <span role="status" className="text-sm text-slate-600">Готовим файл…</span>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}

type ControlsProps = {
  entity: Entity;
  query: URLSearchParams;
  change: (next: URLSearchParams) => void;
  exportUrl: `/${string}`;
  total?: number;
};

export function DiscoveryControls({ entity, query, change, exportUrl, total }: ControlsProps) {
  const task = entity === 'tasks' || entity === 'items';
  const order = entity === 'orders';
  const request = entity === 'requests';
  const supplier = entity === 'suppliers';
  const options = task ? taskStatuses : order ? orderStatuses : request ? requestStatuses : [];
  const select = (
    name: string, label: string, values: readonly (readonly [string, string])[], emptyLabel = 'Все',
  ) => (
    <label className="min-w-0 text-xs font-medium text-slate-600">
      {label}
      <select aria-label={label} className={fieldClass} name={name} defaultValue={query.get(name) ?? ''}>
        <option value="">{emptyLabel}</option>
        {values.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
      </select>
    </label>
  );
  const dateField = (key: string, label: string) => (
    <label className="min-w-0 text-xs font-medium text-slate-600">
      {label}<input type="date" name={key} className={fieldClass} defaultValue={query.get(key) ?? ''} />
    </label>
  );
  const sortOptions: [string, string][] = [['createdAt', 'Дата создания'], ['name', order ? 'Поставщик' : 'Название']];
  if (!supplier) sortOptions.push(['status', 'Статус'], ['deadline', 'Плановый срок'], ['number', order ? 'Номер счёта' : 'Номер']);
  if (task || request) sortOptions.push(['priority', 'Приоритет']);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, data] of new FormData(event.currentTarget)) {
      if (typeof data === 'string' && data.trim()) next.set(key, data.trim());
    }
    change(next);
  }

  return (
    <div className="space-y-3 border-b border-slate-100 p-4 sm:p-5">
      <form key={query.toString()} className="space-y-3" onSubmit={apply}>
        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="min-w-0 text-xs font-medium text-slate-600">
            Поиск
            <input type="search" name="q" className={fieldClass} maxLength={120}
              defaultValue={query.get('q') ?? ''} autoComplete="off" />
          </label>
          {entity === 'tasks' && select('view', 'Закупки', [
            ['active', 'Активные'], ['attention', 'Требуют внимания'], ['logistics', 'В пути / к получению'],
          ])}
          {options.length > 0 && select('status', 'Статус', statusOptions(options))}
          {(task || request) && select('priority', 'Приоритет', Object.entries(priorityLabels))}
        </div>
        <details open={['createdFrom', 'createdTo', 'deadlineFrom', 'deadlineTo', 'supplier', 'overdue', 'hasOrders', 'payment', 'delivery', 'sort', 'direction'].some((key) => query.has(key)) || undefined}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Дополнительные фильтры и сортировка</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {dateField('createdFrom', 'Создано с')}
            {dateField('createdTo', 'Создано по')}
            {!supplier && dateField('deadlineFrom', 'Срок с')}
            {!supplier && dateField('deadlineTo', 'Срок по')}
            {(task || order) && !query.has('supplierId') && (
              <label className="min-w-0 text-xs font-medium text-slate-600">
                Поставщик
                <input name="supplier" className={fieldClass} maxLength={120} defaultValue={query.get('supplier') ?? ''} />
              </label>
            )}
            {(task || order) && select('overdue', order ? 'Плановая дата прибытия' : 'Плановый срок закупки', [['true', 'Просрочен'], ['false', 'Без просрочки']])}
            {task && select('hasOrders', 'Наличие заказов', [['true', 'Есть'], ['false', 'Нет']])}
            {(task || order) && select('payment', 'Оплата', [['paid', 'Подтверждена'], ['unpaid', 'Не подтверждена']])}
            {task && select('delivery', 'Статус заказа', statusOptions(orderStatuses))}
            {select('sort', 'Сортировка', sortOptions, 'Дата создания')}
            {select('direction', 'Направление', [['desc', 'По убыванию'], ['asc', 'По возрастанию']], 'По умолчанию')}
          </div>
          <p className="mt-2 text-xs text-slate-500">Диапазоны дат включают оба дня по Москве.</p>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800" type="submit">Применить</button>
          <button className={buttonClass} type="reset" onClick={() => change(new URLSearchParams())}>Сбросить</button>
          {total !== undefined && <span role="status" className="ml-1 text-sm text-slate-600">Найдено {total}</span>}
        </div>
      </form>
      <ExportButtons key={exportUrl} url={exportUrl} name={entity} />
    </div>
  );
}

export function Pagination({ page, onChange }: { page: Page<unknown> | null; onChange: (page: number) => void }) {
  if (!page || (!page.hasPrevious && !page.hasNext)) return null;
  return (
    <nav aria-label="Страницы результатов" className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-4">
      <button type="button" className={buttonClass} disabled={!page.hasPrevious} onClick={() => onChange(page.page - 1)}>Назад</button>
      <span className="px-2 text-sm text-slate-600">Страница {page.page} из {Math.max(1, Math.ceil(page.total / page.pageSize))}</span>
      <button type="button" className={buttonClass} disabled={!page.hasNext} onClick={() => onChange(page.page + 1)}>Далее</button>
    </nav>
  );
}
