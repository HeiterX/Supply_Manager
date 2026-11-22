'use client';

import { useCallback, useState, type ReactNode } from 'react';
import LoadError from '@/app/components/LoadError';
import { Badge, Button, Card } from '@/app/components/ui';
import { apiFetch } from '@/lib/api-client';
import { useAbortableLoad } from '@/lib/use-abortable-load';
import { workingError } from '@/lib/working-list';

type Action = { title: string; assignee: { fullName: string } | null; dueAt: string | null; reminderAt: string | null; status: string; task: { id: string } };
const statuses: Record<string, string> = {
  OVERDUE: 'Просрочено', TODAY: 'Сегодня', PLANNED: 'Запланировано',
  WAITING_SUPPLIER: 'Ожидает поставщика', COMPLETED: 'Выполнено', CANCELLED: 'Отменено',
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const date = (value: string | null) => value ? dateFormat.format(new Date(value)) : 'Не указано';

export default function WorkNextAction({ id, history, fallback, children }: {
  id: string; history: () => void; fallback: ReactNode; children: ReactNode;
}) {
  const [result, setResult] = useState<{ action?: Action | null; error?: string }>();
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await apiFetch(`/next-actions/by-task/${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
      if (response.status === 404) return;
      if (!response.ok) throw new Error(await workingError(response, 'Не удалось загрузить следующее действие.'));
      const { action } = await response.json() as { action: Action | null };
      if (!signal.aborted) setResult({ action: action?.task.id === id ? action : null });
    } catch (error) {
      if (!signal.aborted) setResult({ error: error instanceof TypeError ? 'Проверьте подключение.' :
        error instanceof Error ? error.message : 'Не удалось загрузить следующее действие.' });
    }
  }, [id]);
  const retry = useAbortableLoad(load);
  const action = result?.action;
  return <Card className="space-y-3 p-5 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="font-semibold">Следующее действие</h2>
      {action && <Badge tone={action.status === 'OVERDUE' ? 'danger' : 'info'}>{statuses[action.status] ?? action.status}</Badge>}
    </div>
    {result?.error && <LoadError message={result.error} retry={() => void retry()} />}
    {action ? <>
      <p className="text-lg font-semibold">{action.title}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
      <div><dt className="text-muted">Ответственный</dt><dd>{action.assignee?.fullName || 'Не указано'}</dd></div>
      <div><dt className="text-muted">Срок действия</dt><dd>{date(action.dueAt)}</dd></div>
      <div><dt className="text-muted">Напоминание</dt><dd>{date(action.reminderAt)}</dd></div>
      </dl>
    </> : fallback}
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <div className="min-w-0 grow">{children}</div>
      <Button variant="ghost" onClick={history}>История закупки</Button>
    </div>
  </Card>;
}
