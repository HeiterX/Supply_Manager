'use client';

import { useState, type ReactNode } from 'react';
import { viewKeys, type WorkingList } from '@/lib/working-list';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select, Skeleton, TableRegion } from './ui';
import LoadError from './LoadError';
import { DiscoveryControls } from './DiscoveryControls';

type Choice = readonly [string, string];
const purchaseViews = [
  ['Все', {}],
  ['Активные', { view: 'active' }],
  ['Просроченные', { overdue: 'true' }],
  ['Ожидают поставки', { view: 'logistics' }],
  ['Завершённые', { status: 'CLOSED' }],
] as const;
const sorts = [['createdAt', 'Дата создания'], ['number', 'Номер'], ['deadline', 'Срок'], ['priority', 'Приоритет'], ['status', 'Статус']] as const;
const presetKey = 'supply-manager:procurement-view';

export function WorkingTableControls({ list, statuses, purchases = false, registry = false, entity }: {
  list: WorkingList;
  statuses: readonly Choice[];
  purchases?: boolean;
  registry?: boolean;
  entity?: 'tasks' | 'requests' | 'items';
}) {
  const { query, change } = list;
  const [feedback, setFeedback] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  function update(values: Record<string, string>, reset: string[] = []) {
    const next = new URLSearchParams(window.location.search);
    for (const key of ['page', ...reset]) next.delete(key);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    change(next);
  }

  function saveView() {
    try {
      const current = new URLSearchParams(window.location.search);
      const preferences = Object.fromEntries(viewKeys.flatMap((key) => current.has(key) ? [[key, current.get(key)!]] : []));
      localStorage.setItem(presetKey, JSON.stringify(preferences));
      setFeedback('Представление сохранено в этом браузере.');
    } catch {
      setFeedback('Хранилище браузера недоступно.');
    }
  }

  function restoreView() {
    try {
      const stored = localStorage.getItem(presetKey);
      if (!stored) { setFeedback('Сохранённого представления пока нет.'); return; }
      const parsed: Record<string, unknown> = JSON.parse(stored);
      const preferences = Object.fromEntries(viewKeys.flatMap((key) =>
        typeof parsed?.[key] === 'string' ? [[key, parsed[key]]] : [])) as Record<string, string>;
      update(preferences, [...viewKeys, 'q']);
      setFeedback('Сохранённое представление применено.');
    } catch {
      setFeedback('Не удалось прочитать сохранённое представление.');
    }
  }

  if (list.legacy) return <Alert>Поиск, фильтры и страницы появятся, когда сервер подключит CORE‑11.</Alert>;
  return <Card className="min-w-0 space-y-4 p-4">
    {purchases && <div className="flex flex-wrap gap-2" role="group" aria-label="Быстрые фильтры">
      {purchaseViews.map(([label, values]) => {
        const keys = ['view', 'status', 'overdue', 'delivery'];
        const active = keys.every((key) => (query.get(key) ?? '') === ((values as Record<string, string>)[key] ?? ''));
        return <Button key={label} aria-pressed={active} variant={active ? 'secondary' : 'outline'}
          onClick={() => update(values, keys)}>{label}</Button>;
      })}
    </div>}
    <div className="grid min-w-0 grid-cols-2 items-end gap-3 xl:grid-cols-[minmax(235px,2fr)_repeat(3,minmax(120px,1fr))]">
      <form className="col-span-2 flex min-w-0 items-end gap-2 xl:col-span-1" key={query.get('q') ?? ''} role="search"
        onSubmit={(event) => { event.preventDefault(); update({ q: String(new FormData(event.currentTarget).get('q') ?? '').trim() }); }}>
        <div className="min-w-0 flex-1">
          <Field id="working-search" label="Поиск"><Input id="working-search" name="q" type="search"
            defaultValue={query.get('q') ?? ''} maxLength={120} placeholder={registry ? 'Позиция, артикул или закупка' : 'Номер или название'} /></Field>
        </div>
        <Button type="submit" variant="outline">Найти</Button>
      </form>
      <Field id="working-status" label="Статус"><Select id="working-status" value={query.get('status') ?? ''}
        onChange={(event) => update({ status: event.target.value }, ['view', 'overdue', 'delivery'])}>
        <option value="">Все статусы</option>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select></Field>
      <Field id="working-sort" label="Сортировка"><Select id="working-sort" value={query.get('sort') ?? 'createdAt'}
        onChange={(event) => update({ sort: event.target.value })}>
        {sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        {registry && <option value="name">Наименование</option>}
      </Select></Field>
      <Field id="working-direction" label="Порядок"><Select id="working-direction" value={query.get('direction') ?? 'desc'}
        onChange={(event) => update({ direction: event.target.value })}>
        <option value="desc">По убыванию</option><option value="asc">По возрастанию</option>
      </Select></Field>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {query.size > 0 && <Button variant="ghost" onClick={() => change(new URLSearchParams())}>Сбросить</Button>}
      {purchases && <>
        <Button variant="ghost" onClick={saveView}>Сохранить вид</Button>
        <Button variant="ghost" onClick={restoreView}>Мой вид</Button>
      </>}
      {feedback && <span role="status" className="text-sm text-muted">{feedback}</span>}
    </div>
    {entity && <details onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">Расширенные фильтры и экспорт</summary>
      {advancedOpen && <DiscoveryControls entity={entity} query={query} change={change} total={list.page?.total}
        exportUrl={`/discovery/lists/${entity}/export?${query}`} />}
    </details>}
  </Card>;
}

export function WorkingTable({ list, label, headers, empty, filtered = false, children }: {
  list: WorkingList;
  label: string;
  headers: string[];
  empty: string;
  filtered?: boolean;
  children: ReactNode;
}) {
  const { page, query, change, loading, legacy } = list;
  function setPage(value: number, pageSize?: string) {
    const next = new URLSearchParams(window.location.search);
    next.set('page', String(value));
    if (pageSize) next.set('pageSize', pageSize);
    change(next);
  }

  const narrowed = filtered || [...query.keys()].some((key) => !['page', 'pageSize', 'sort', 'direction'].includes(key))
    || Number(query.get('page')) > 1;
  return <div className="min-w-0 space-y-3" aria-busy={loading}>
    {loading && <p role="status" className="sr-only">Загрузка списка</p>}
    {list.error ? <LoadError message={list.error} retry={list.reload} /> : !page ? <Skeleton /> : <>
      {page.items.length === 0
        ? <EmptyState title={narrowed ? 'По текущим параметрам ничего не найдено' : empty}
          description={narrowed ? 'Измените поиск или фильтры либо вернитесь на первую страницу.' : undefined} />
        : <TableRegion label={label} className={`working-table md:border md:border-border md:bg-surface ${loading ? 'opacity-60' : ''}`}>
          <table role="table"><thead role="rowgroup"><tr role="row">{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
            <tbody role="rowgroup">{children}</tbody>
          </table>
        </TableRegion>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge>Всего {page.total}</Badge>
        {!legacy && <nav className="flex flex-wrap items-center gap-2" aria-label="Страницы списка">
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="working-page-size">На странице</label>
            <Select id="working-page-size" className="w-auto" value={query.get('pageSize') ?? '25'} disabled={loading}
              onChange={(event) => setPage(1, event.target.value)}>
              {[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}
            </Select>
          </div>
          <Button variant="outline" disabled={loading || !page.hasPrevious} onClick={() => setPage(page.page - 1)}>Назад</Button>
          <span className="text-sm tabular-nums" aria-live="polite">{page.page} / {Math.max(1, Math.ceil(page.total / page.pageSize))}</span>
          <Button variant="outline" disabled={loading || !page.hasNext} onClick={() => setPage(page.page + 1)}>Далее</Button>
        </nav>}
      </div>
    </>}
  </div>;
}
