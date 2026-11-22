'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { core09Request, Core09Error, errorMessage, formatActionDate, localDateTime, uniqueById, type ActionHistory, type NextAction } from '../../../lib/core09-api';
import { useCore09Resource } from '../../../lib/use-core09-resource';
import { ActionCard } from './ActionCard';
import { controlClass, ResourceError, Skeleton } from './ResourceState';

function History({ actionId }: { actionId: string }) {
  const loader = useCallback((signal: AbortSignal) => core09Request<{ items: ActionHistory[] }>(`/next-actions/${encodeURIComponent(actionId)}/history`, signal), [actionId]);
  const state = useCore09Resource(`history:${actionId}`, loader);
  const labels: Record<string, string> = { CREATED: 'Создано действие', ASSIGNED: 'Назначен ответственный', RESCHEDULED: 'Перенесён срок', UPDATED: 'Изменено действие', COMPLETED: 'Выполнено', CANCELLED: 'Отменено' };
  if (state.status === 'loading') return <Skeleton />;
  if (state.status === 'unavailable') return <p className="text-sm text-slate-500">История действий пока не предоставляется сервером.</p>;
  if (state.status !== 'ready') return <ResourceError error={state.error} retry={state.refresh} />;
  return <ol aria-label="История следующего действия" className="ml-2 border-l border-slate-200 pl-5">{uniqueById(state.data?.items ?? []).map(item => <li className="relative pb-5 last:pb-0" key={item.id}><span aria-hidden="true" className="absolute -left-[25px] top-1 h-2 w-2 rounded-full bg-blue-600" /><p className="text-sm font-semibold">{labels[item.type] ?? 'Событие'}</p><time dateTime={item.createdAt} className="text-xs text-slate-500">{formatActionDate(item.createdAt)}</time><p className="mt-1 text-sm text-slate-600">{item.actor?.fullName ?? 'Система'}</p>{item.comment && <p className="mt-1 break-words text-sm">{item.comment}</p>}</li>)}{!state.data?.items.length && <li className="text-sm text-slate-500">Событий пока нет.</li>}</ol>;
}
function ActionEditor({ action, onSuccess, onConflict }: { action: NextAction; onSuccess: () => void; onConflict: () => void }) {
  const [title, setTitle] = useState(action.title);
  const [dueAt, setDueAt] = useState(localDateTime(action.dueAt));
  const [reminderAt, setReminderAt] = useState(localDateTime(action.reminderAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const saved = useRef(false);
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || saved.current) return;
    if (!title.trim() || title.trim().length > 500) { setError('Укажите действие длиной от 1 до 500 символов.'); return; }
    if ((dueAt && !Number.isFinite(new Date(dueAt).getTime())) || (reminderAt && !Number.isFinite(new Date(reminderAt).getTime()))) { setError('Укажите корректные даты.'); return; }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError('');
    try {
      await core09Request(`/next-actions/${encodeURIComponent(action.id)}`, controller.signal, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': `"${action.version}"`, 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ title: title.trim(), dueAt: dueAt ? new Date(dueAt).toISOString() : null, reminderAt: reminderAt ? new Date(reminderAt).toISOString() : null }),
      });
      if (!controller.signal.aborted) { saved.current = true; onSuccess(); }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorMessage(error));
        if (error instanceof Core09Error && error.status === 409) onConflict();
      }
    } finally { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <label className="block text-sm font-medium">Следующее действие<textarea aria-label="Следующее действие" required maxLength={500} value={title} onChange={event => setTitle(event.target.value)} className={`${controlClass} mt-2 w-full`} /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="min-w-0 text-sm font-medium">Срок действия<input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} className={`${controlClass} mt-2 w-full min-w-0`} /></label><label className="min-w-0 text-sm font-medium">Напоминание<input type="datetime-local" value={reminderAt} onChange={event => setReminderAt(event.target.value)} className={`${controlClass} mt-2 w-full min-w-0`} /></label></div>
    <p className="text-xs text-slate-500">Ввод дат: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Сервер проверит допустимость срока и напоминания.</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Сохраняем…' : 'Сохранить действие'}</button>
  </form>;
}
export default function TaskNextAction({ task, openLegacyHistory }: { task: { id: string; nextAction: string | null; reminderAt: string | null }; openLegacyHistory: () => void }) {
  const loader = useCallback((signal: AbortSignal) => core09Request<{ action: NextAction | null; timeZone: string }>(`/next-actions/by-task/${encodeURIComponent(task.id)}`, signal), [task.id]);
  const state = useCore09Resource(`task-action:${task.id}`, loader);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [message, setMessage] = useState('');
  const action = state.data?.action?.task.id === task.id ? state.data.action : null;
  return <section aria-label="Следующее действие по закупке" className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold uppercase tracking-wide text-blue-700">Следующее действие</h2><button className="text-sm font-semibold text-blue-700" onClick={openLegacyHistory}>История закупки →</button></div>
    {state.status === 'loading' && <Skeleton />}
    {state.status === 'error' && <ResourceError error={state.error} retry={state.refresh} />}
    {state.status === 'unavailable' && <><p className="text-lg font-semibold text-slate-950">{task.nextAction ?? 'Действие не задано'}</p><p className="mt-2 text-sm text-slate-600">Напоминание: {formatActionDate(task.reminderAt)}</p><p className="mt-3 text-xs leading-5 text-slate-500">Ответственный, срок действия и серверный статус пока недоступны. Напоминание не является сроком выполнения.</p></>}
    {state.status === 'ready' && (!action ? <p className="text-sm text-slate-500">Следующее действие не задано.</p> : <>
      <ActionCard action={action} linked={false} timeZone={state.data?.timeZone} />
      <div className="mt-3 flex flex-wrap gap-2">{action.allowedOperations.includes('UPDATE') && <button aria-expanded={editing} onClick={() => setEditing(value => !value)} className={controlClass}>{editing ? 'Отменить редактирование' : 'Изменить действие'}</button>}<button aria-expanded={history} onClick={() => setHistory(value => !value)} className={controlClass}>История действия</button></div>
      {editing && action.allowedOperations.includes('UPDATE') && <ActionEditor key={`${action.id}:${action.version}`} action={action} onSuccess={() => { setEditing(false); setMessage('Действие сохранено.'); state.refresh(); }} onConflict={() => { setMessage('Действие изменено другим пользователем. Обновляем данные; проверьте их перед повтором.'); setEditing(false); state.refresh(); }} />}
      {history && <div className="mt-5"><History key={`${action.id}:${action.version}`} actionId={action.id} /></div>}
    </>)}
    {message && <p role="status" className="mt-3 text-sm text-blue-900">{message}</p>}
  </section>;
}
