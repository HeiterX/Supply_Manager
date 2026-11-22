'use client';
import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '../components/AuthGate';
import AppShell from '../components/AppShell';
import { NotificationList, useNotifications } from '../components/core09/NotificationCenter';
import { controlClass, NotConnected, ResourceError, Skeleton } from '../components/core09/ResourceState';
import { loadNotices, pageFromQuery } from '../../lib/core09-api';
import { useCore09Resource } from '../../lib/use-core09-resource';

function NotificationsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const filter = params.get('filter') === 'unread' ? 'unread' : params.get('filter') === 'read' ? 'read' : 'all';
  const page = pageFromQuery(params.get('page'));
  const { revision, readError, feed } = useNotifications();
  const sharedFeed = filter === 'all' && page === 1;
  const loader = useCallback((signal: AbortSignal) => loadNotices(filter, page, signal), [filter, page]);
  const ownState = useCore09Resource(`notice-page:${filter}:${page}:${revision}`, loader, true, !sharedFeed);
  const state = sharedFeed ? feed : ownState;
  function navigate(value: string, page = 1) { router.push(`/notifications?filter=${value}&page=${page}`, { scroll: false }); }
  return <AppShell title="Уведомления" subtitle="События по вашим закупкам и следующим действиям" action={<button onClick={state.refresh} className={controlClass}>Обновить</button>}>
    <div className="mb-5 flex flex-wrap gap-2" aria-label="Фильтры уведомлений">{[['all', 'Все'], ['unread', 'Непрочитанные'], ['read', 'Прочитанные']].map(([value, label]) => <button aria-pressed={filter === value} key={value} onClick={() => navigate(value)} className={`${controlClass} ${filter === value ? 'border-blue-400 bg-blue-50 font-semibold text-blue-700' : ''}`}>{label}</button>)}</div>
    {readError && <p role="alert" className="mb-4 text-sm text-rose-700">{readError}</p>}
    {state.status === 'loading' && <Skeleton />}
    {state.status === 'unavailable' && <NotConnected />}
    {state.status === 'error' && <ResourceError error={state.error} retry={state.refresh} />}
    {state.status === 'ready' && <><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><NotificationList items={state.data?.items ?? []} /></div><div className="mt-5 flex items-center justify-between"><button disabled={page <= 1} onClick={() => navigate(filter, page - 1)} className={controlClass}>Назад</button><span className="text-sm text-slate-500">Страница {page} · Всего {state.data?.total ?? 0}</span><button disabled={page * (state.data?.pageSize ?? 20) >= (state.data?.total ?? 0)} onClick={() => navigate(filter, page + 1)} className={controlClass}>Далее</button></div></>}
  </AppShell>;
}
export default function NotificationsPage() { return <AuthGate><Suspense fallback={<Skeleton />}><NotificationsContent /></Suspense></AuthGate>; }
