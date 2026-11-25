'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { core09Request, errorMessage, formatActionDate, loadNotices, uniqueById, type Notice } from '../../../lib/core09-api';
import { useCore09Resource } from '../../../lib/use-core09-resource';
import { controlClass, NotConnected, ResourceError, Skeleton } from './ResourceState';

function useNotificationStore() {
  const [revision, setRevision] = useState(0);
  const loader = useCallback((signal: AbortSignal) => loadNotices('all', 1, signal), []);
  const feed = useCore09Resource(`notifications:${revision}`, loader, true);
  const [reading, setReading] = useState<string[]>([]);
  const [readError, setReadError] = useState('');
  const pending = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const requests = pending.current;
    return () => { requests.forEach(controller => controller.abort()); requests.clear(); };
  }, []);
  const markRead = useCallback(async (id: string) => {
    if (pending.current.has(id)) return;
    const controller = new AbortController();
    pending.current.set(id, controller);
    setReading(ids => [...ids, id]);
    setReadError('');
    try {
      await core09Request(`/notifications/${encodeURIComponent(id)}/read`, controller.signal, { method: 'PATCH' });
      if (!controller.signal.aborted) setRevision(value => value + 1);
    } catch (error) {
      if (!controller.signal.aborted) setReadError(errorMessage(error));
    } finally {
      pending.current.delete(id);
      if (!controller.signal.aborted) setReading(ids => ids.filter(value => value !== id));
    }
  }, []);
  return { feed, markRead, reading, readError, revision };
}
const NotificationContext = createContext<ReturnType<typeof useNotificationStore> | null>(null);
export function NotificationProvider({ children }: { children: ReactNode }) {
  const store = useNotificationStore();
  return <NotificationContext.Provider value={store}>{children}</NotificationContext.Provider>;
}
export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('NotificationProvider is required inside authorized AuthGate');
  return context;
}
const noticeLabels: Record<string, string> = {
  ACTION_DUE: 'Приближается срок', ACTION_OVERDUE: 'Действие просрочено', ASSIGNEE_CHANGED: 'Изменён ответственный',
  DUE_DATE_CHANGED: 'Изменён срок', ACTION_CREATED: 'Новое действие', ACTION_COMPLETED: 'Действие выполнено', ATTENTION_REQUIRED: 'Требуется внимание',
};
export function NotificationList({ items }: { items: Notice[] }) {
  const { markRead, reading } = useNotifications();
  if (!items.length) return <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Новых уведомлений нет</p>;
  return <ul className="divide-y divide-slate-100">{uniqueById(items).map(item => <li key={item.id} className={`p-4 ${item.readAt ? 'bg-white' : 'bg-blue-50/60'}`}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className={item.type === 'ACTION_OVERDUE' ? 'font-semibold text-rose-700' : 'font-semibold text-blue-700'}>{noticeLabels[item.type] ?? 'Уведомление'}</span><span className="text-slate-500">{item.readAt ? 'Прочитано' : 'Не прочитано'}</span></div>
    <Link className="mt-2 block break-words font-semibold text-slate-950 hover:text-blue-700" href={`/tasks/${encodeURIComponent(item.task.id)}`}>{item.title}</Link>
    <p className="mt-1 break-words text-sm text-slate-600">№{item.task.number} · {item.task.title}</p>
    {item.message && <p className="mt-2 break-words text-sm text-slate-600">{item.message}</p>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><time className="text-xs text-slate-500" dateTime={item.createdAt}>{formatActionDate(item.createdAt)}</time>{!item.readAt && <button disabled={reading.includes(item.id)} onClick={() => void markRead(item.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">{reading.includes(item.id) ? 'Сохраняем…' : 'Отметить прочитанным'}</button>}</div>
  </li>)}</ul>;
}
export function NotificationBell() {
  const { feed, readError } = useNotifications();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  const count = feed.status === 'ready' ? feed.data?.unreadCount : undefined;
  return <div ref={root} className="relative" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} aria-label={`Уведомления${count === undefined ? ', счётчик недоступен' : `, непрочитанных: ${count}`}`} aria-expanded={open} aria-controls="notification-panel" onClick={() => setOpen(value => !value)} className="relative grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-blue-50">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {count !== undefined && count > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1 text-center text-[10px] leading-5 font-bold text-white">{count > 99 ? '99+' : count}</span>}
    </button>
    {open && <section id="notification-panel" aria-label="Панель уведомлений" className="fixed left-3 right-3 top-36 z-50 max-h-[65vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:left-auto sm:right-0 sm:top-14 sm:w-96">
      <div className="flex items-center justify-between border-b border-slate-100 p-4"><h2 className="font-semibold">Уведомления</h2><button onClick={() => { setOpen(false); trigger.current?.focus(); }} aria-label="Закрыть уведомления" className="rounded-lg px-2 py-1 text-slate-500">×</button></div>
      {feed.status === 'loading' && <div className="p-4"><Skeleton /></div>}
      {feed.status === 'unavailable' && <div className="p-4"><NotConnected /></div>}
      {feed.status === 'error' && <div className="p-4"><ResourceError error={feed.error} retry={feed.refresh} /></div>}
      {readError && <p role="alert" className="p-4 text-sm text-rose-700">{readError}</p>}
      {feed.status === 'ready' && <NotificationList items={feed.data?.items.slice(0, 5) ?? []} />}
      <div className="border-t border-slate-100 p-4"><Link href="/notifications" className={`${controlClass} block text-center`}>Все уведомления →</Link></div>
    </section>}
  </div>;
}
