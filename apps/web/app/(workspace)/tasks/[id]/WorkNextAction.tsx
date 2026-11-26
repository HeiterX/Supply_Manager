'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from '@/app/components/AuthGate';
import LoadError from '@/app/components/LoadError';
import { Badge, Button, Card, Input, Textarea, Select } from '@/app/components/ui';
import { core09Request, errorMessage, formatActionDate, localDateTime, type NextAction, type ActionHistory } from '@/lib/core09-api';
import { useCore09Resource } from '@/lib/use-core09-resource';

type Assignee = { id: string; fullName: string; role: string };
type ActionResult = { action: NextAction | null; lastActionId: string | null; timeZone: string };
const labels: Record<string,string> = {
  OVERDUE: 'Просрочено', TODAY: 'Сегодня', PLANNED: 'Запланировано',
  WAITING_SUPPLIER: 'Ожидаем поставщика', COMPLETED: 'Выполнено', CANCELLED: 'Отменено',
};

function History({ actionId }: { actionId: string }) {
  const load = useCallback((signal: AbortSignal) =>
    core09Request<{ items: ActionHistory[] }>('/next-actions/' + encodeURIComponent(actionId) + '/history', signal), [actionId]);
  const state = useCore09Resource('history:' + actionId, load);
  if (state.status === 'loading') return <p className="text-sm text-muted">Загрузка истории…</p>;
  if (state.status !== 'ready') return <LoadError message={state.error ?? 'История недоступна'} retry={state.refresh} />;
  return <ol className="space-y-3 border-l-2 border-slate-200 pl-4" aria-label="История действий">
    {state.data?.items.map(item => <li key={item.id} className="text-sm">
      <span className="font-medium">{item.type}</span>
      <time className="ml-2 text-muted" dateTime={item.createdAt}>{formatActionDate(item.createdAt)}</time>
      <p className="text-muted">{item.actor?.fullName ?? 'Система'}{item.comment ? ': ' + item.comment : ''}</p>
    </li>)}
    {!state.data?.items.length && <li className="text-sm text-muted">История пока пуста.</li>}
  </ol>;
}

export default function WorkNextAction({ id, history, fallback, children, taskStatus }: {
  id: string; history: () => void; fallback: ReactNode; children: ReactNode; taskStatus?: string;
}) {
  const { user } = useSession();
  const [revision, setRevision] = useState(0);
  const load = useCallback((signal: AbortSignal) =>
    core09Request<ActionResult>('/next-actions/by-task/' + encodeURIComponent(id), signal), [id]);
  const state = useCore09Resource('next-action:' + id + ':' + revision, load);
  const action = state.data?.action ?? null;
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);


  useEffect(() => {
    if (user.role !== 'ADMIN') return;
    const controller = new AbortController();
    core09Request<Assignee[]>('/next-actions/assignees', controller.signal)
      .then(users => { if (!controller.signal.aborted) setAssignees(users); })
      .catch(() => { /* valid view stays usable; assign changes disabled if lookup fails */ });
    return () => controller.abort();
  }, [user.role]);

  async function persist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    if (!title.trim() || title.trim().length > 500) { setError('Укажите действие длиной от 1 до 500 символов.'); return; }
    if (dueAt && reminderAt && new Date(reminderAt) > new Date(dueAt)) {
      setError('Напоминание должно быть не позже срока действия.'); return;
    }
    saving.current = true; setBusy(true); setError(''); setMessage('');
    const controller = new AbortController();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (action) { headers['If-Match'] = '"' + action.version + '"'; headers['Idempotency-Key'] = crypto.randomUUID(); }
      const path = action ? '/next-actions/' + encodeURIComponent(action.id) : '/next-actions/by-task/' + encodeURIComponent(id);
      await core09Request(path as `/${string}`, controller.signal, {
        method: action ? 'PATCH' : 'POST', headers,
        body: JSON.stringify({
          title: title.trim(),
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          reminderAt: reminderAt ? new Date(reminderAt).toISOString() : null,
          ...(user.role === 'ADMIN' && assignees.length ? { assigneeId: assigneeId || null } : {}),
        }),
      });
      setEditing(false); setMessage('Действие сохранено'); setRevision(value => value + 1);
    } catch (e) {
      setError(errorMessage(e));
      if (action) setRevision(value => value + 1);
    } finally { saving.current = false; setBusy(false); }
  }

  async function complete() {
    if (!action || saving.current || !confirm('Отметить действие выполненным?')) return;
    saving.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await core09Request('/next-actions/' + encodeURIComponent(action.id) + '/complete', new AbortController().signal, {
        method: 'POST',
        headers: { 'If-Match': '"' + action.version + '"', 'Idempotency-Key': crypto.randomUUID() },
      });
      setEditing(false); setMessage('Действие выполнено. Назначьте следующий шаг.'); setRevision(value => value + 1);
    } catch (e) { setError(errorMessage(e)); setRevision(value => value + 1); }
    finally { saving.current = false; setBusy(false); }
  }
  const terminal = taskStatus === 'CLOSED' || taskStatus === 'CANCELLED';
  const own = user.role === 'ADMIN' || !action?.assignee || action.assignee.id === user.id;
  const allowed = action?.allowedOperations.includes('UPDATE') ?? false;
  const historyId = action?.id ?? state.data?.lastActionId;
  return <Card className="space-y-4 p-5 [overflow-wrap:anywhere]" aria-label="Следующее действие по закупке">
    <div className="flex flex-wrap justify-between gap-2">
      <h2 className="font-semibold">Следующее действие</h2>
      {action && <Badge tone={action.status === 'OVERDUE' ? 'danger' : action.status === 'TODAY' ? 'warning' : 'info'}>{labels[action.status] ?? action.status}</Badge>}
    </div>
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {state.status === 'loading' && <p role="status" className="text-sm text-muted">Загрузка действия…</p>}
    {state.status === 'error' && <LoadError message={state.error ?? 'Ошибка загрузки'} retry={state.refresh} />}
    {state.status === 'unavailable' && <><p className="text-xs text-muted">Сервис действий недоступен; показаны прежние данные.</p>{fallback}</>}
    {state.status === 'ready' && <>
      {action ? <>
        <p className="text-lg font-semibold">{action.title}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted">Ответственный</dt><dd>{action.assignee?.fullName ?? 'Не назначен'}</dd></div>
          <div><dt className="text-muted">Выполнить до</dt><dd>{formatActionDate(action.dueAt, state.data?.timeZone)}</dd></div>
          <div><dt className="text-muted">Напомнить</dt><dd>{formatActionDate(action.reminderAt, state.data?.timeZone)}</dd></div>
        </dl>
        {(!action.assignee || !action.dueAt) && <p className="text-sm text-amber-700">Для полноценного контроля назначьте ответственного и срок действия.</p>}
      </> : <p className="text-sm text-muted">{terminal ? 'Закупка завершена' : 'Активного следующего действия нет. Создайте новое.'}</p>}
      {!terminal && own && <div className="flex flex-wrap gap-2">
        {(!action || allowed) && <Button variant="outline" onClick={() => {
          if (!editing) {
            setTitle(action?.title ?? '');
            setDueAt(localDateTime(action?.dueAt ?? null));
            setReminderAt(localDateTime(action?.reminderAt ?? null));
            setAssigneeId(action?.assignee?.id ?? '');
          }
          setEditing(value => !value); setError('');
        }}>{editing ? 'Отменить редактирование' : action ? 'Изменить действие' : 'Создать действие'}</Button>}
        {action?.allowedOperations.includes('COMPLETE') && <Button variant="outline" loading={busy} onClick={() => void complete()}>Выполнено</Button>}
      </div>}
      {editing && !terminal && (!action || allowed) && <form className="grid gap-3 border-t border-slate-100 pt-4" onSubmit={persist}>
        <label className="text-sm font-medium">Следующее действие
          <Textarea className="mt-1 w-full" required rows={2} maxLength={500} value={title} onChange={e => setTitle(e.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Срок выполнения
            <Input className="mt-1 w-full" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />
          </label>
          <label className="text-sm font-medium">Напомнить
            <Input className="mt-1 w-full" type="datetime-local" value={reminderAt} onChange={e => setReminderAt(e.target.value)} />
          </label>
        </div>
        {user.role === 'ADMIN' && assignees.length > 0 && <label className="text-sm font-medium">Ответственный
          <Select className="mt-1 w-full" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
            <option value="">Не назначен</option>
            {assignees.map(person => <option key={person.id} value={person.id}>{person.fullName} ({person.role})</option>)}
          </Select>
        </label>}
        <p className="text-xs text-muted">Даты вводятся во времени устройства; сервер показывает сроки в Europe/Moscow.</p>
        <Button type="submit" loading={busy}>Сохранить</Button>
      </form>}
      {historyId && <div><Button variant="ghost" onClick={() => setShowHistory(value => !value)}>{showHistory ? 'Скрыть историю действия' : 'История действия'}</Button>
        {showHistory && <History actionId={historyId} />}</div>}
    </>}
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
      <div className="min-w-0 grow">{children}</div>
      <Button variant="ghost" onClick={history}>История закупки</Button>
    </div>
  </Card>;
}
