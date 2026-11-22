'use client';
import { Suspense, useCallback, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '../components/AuthGate';
import AppShell from '../components/AppShell';
import { ActionCard } from '../components/core09/ActionCard';
import { controlClass, NotConnected, ResourceError, Skeleton } from '../components/core09/ResourceState';
import { core09Request, loadActions, formatActionDate, uniqueById, pageFromQuery, type ActionFilter } from '../../lib/core09-api';
import { useCore09Resource } from '../../lib/use-core09-resource';

const filters: [ActionFilter, string][] = [['all', 'Все активные'], ['today', 'Сегодня'], ['overdue', 'Просрочено'], ['waiting_supplier', 'Ожидаем поставщика']];
type LegacyTask = { id: string; number: number; title: string; nextAction: string | null; reminderAt: string | null };
function LegacyActions() {
  const loader = useCallback((signal: AbortSignal) => core09Request<LegacyTask[]>('/tasks', signal), []);
  const state = useCore09Resource('legacy-actions', loader);
  if (state.status === 'loading') return <Skeleton />;
  if (state.status !== 'ready') return <ResourceError error={state.error} retry={state.refresh} />;
  const items = state.data?.filter(item => item.nextAction) ?? [];
  return <section className="mt-6"><h2 className="mb-3 text-lg font-semibold">Действия по доступным закупкам</h2><p className="mb-4 text-sm text-slate-500">Текущие данные закупок. Персональное назначение, срок действия и срочность сервером ещё не предоставляются.</p><div className="grid gap-4 xl:grid-cols-2">{items.map(item => <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">Закупка №{item.number} · {item.title}</p><h3 className="mt-2 font-semibold">{item.nextAction}</h3><p className="my-3 text-sm text-slate-500">Напоминание: {formatActionDate(item.reminderAt)}</p><Link className="text-sm font-semibold text-blue-700" href={`/tasks/${encodeURIComponent(item.id)}`}>Открыть закупку →</Link></article>)}</div>{!items.length && <p className="rounded-2xl bg-white p-8 text-center text-slate-500">В доступных закупках нет заданных действий.</p>}</section>;
}
function ActionsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const filter = filters.some(([value]) => value === params.get('filter')) ? params.get('filter') as ActionFilter : 'all';
  const query = params.get('q') ?? '';
  const page = pageFromQuery(params.get('page'));
  const [revision, setRevision] = useState(0);
  const loader = useCallback((signal: AbortSignal) => loadActions(filter, query, page, signal), [filter, query, page]);
  const state = useCore09Resource(`actions:${filter}:${query}:${page}:${revision}`, loader);
  function navigate(value: ActionFilter, q = query, targetPage = 1) {
    router.push(`/actions?${new URLSearchParams({ filter: value, q, page: String(targetPage) })}`, { scroll: false });
  }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); navigate(filter, String(new FormData(event.currentTarget).get('q') ?? '').trim()); }
  return <AppShell title="Мои действия" subtitle="Следующий шаг по каждой закупке — в одном месте" action={<button onClick={() => setRevision(value => value + 1)} className={controlClass}>Обновить</button>}>
    <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">{filters.map(([value, label]) => <button key={value} disabled={state.status === 'unavailable'} onClick={() => navigate(value)} aria-pressed={filter === value} className={`rounded-2xl border p-4 text-left shadow-sm disabled:opacity-60 ${value === filter ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}><span className="text-sm text-slate-600">{label}</span><span className={`mt-2 block text-2xl font-semibold ${value === 'overdue' ? 'text-rose-700' : 'text-slate-950'}`}>{state.status === 'ready' ? state.data?.counts[value] ?? '—' : '—'}</span></button>)}</div>
    <form onSubmit={search} className="mb-5 flex flex-wrap gap-3"><label className="min-w-0 flex-1"><span className="sr-only">Поиск по закупке</span><input key={query} name="q" defaultValue={query} placeholder="Номер или название закупки" className={`${controlClass} w-full`} maxLength={200} /></label><button className={controlClass} disabled={state.status === 'unavailable'}>Найти</button></form>
    <p className="mb-5 text-xs text-slate-500">Сортировка: ближайший срок. {state.data?.timeZone ? `Сроки и фильтры: ${state.data.timeZone}.` : 'Даты напоминаний — в часовом поясе устройства.'}</p>
    {state.status === 'loading' && <Skeleton />}
    {state.status === 'unavailable' && <><NotConnected>Сервер пока не предоставляет персональные действия и статусы срочности. Фильтры и счётчики станут доступны после подключения.</NotConnected><LegacyActions /></>}
    {state.status === 'error' && <ResourceError error={state.error} retry={state.refresh} />}
    {state.status === 'ready' && <><div className="grid gap-4 xl:grid-cols-2">{uniqueById(state.data?.items ?? []).map(action => <ActionCard key={action.id} action={action} timeZone={state.data?.timeZone} />)}</div>{!state.data?.items.length && <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">По выбранным условиям действий нет.</p>}<div className="mt-6 flex items-center justify-between gap-3"><button disabled={page <= 1} onClick={() => navigate(filter, query, page - 1)} className={controlClass}>Назад</button><span className="text-sm text-slate-500">Страница {page} · Всего {state.data?.total ?? 0}</span><button disabled={page * (state.data?.pageSize ?? 20) >= (state.data?.total ?? 0)} onClick={() => navigate(filter, query, page + 1)} className={controlClass}>Далее</button></div></>}
  </AppShell>;
}
export default function ActionsPage() { return <AuthGate><Suspense fallback={<Skeleton />}><ActionsContent /></Suspense></AuthGate>; }
