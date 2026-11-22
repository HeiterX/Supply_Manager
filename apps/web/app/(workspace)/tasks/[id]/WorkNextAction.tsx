'use client';

import { useCallback, useState } from 'react';
import LoadError from '@/app/components/LoadError';
import { Alert, Badge, Button, Card } from '@/app/components/ui';
import { apiFetch } from '@/lib/api-client';
import { useAbortableLoad } from '@/lib/use-abortable-load';
import { workingDate, workingError } from '@/lib/working-list';

type Action = { title: string; assignee: { fullName: string } | null; dueAt: string | null; reminderAt: string | null; status: string; task: { id: string } };
const statuses: Record<string, string> = {
  OVERDUE: 'Просрочено', TODAY: 'Сегодня', PLANNED: 'Запланировано',
  WAITING_SUPPLIER: 'Ожидает поставщика', COMPLETED: 'Выполнено', CANCELLED: 'Отменено',
};

export default function WorkNextAction({ id, history }: { id: string; history: () => void }) {
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
  if (!result) return null;
  if (result.error) return <LoadError message={result.error} retry={() => void retry()} />;
  const action = result.action;
  if (!action) return <Alert>Следующее действие не назначено.</Alert>;
  return <Card className="space-y-3 p-4 [overflow-wrap:anywhere]">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="font-semibold">Следующее действие</h2><Badge tone={action.status === 'OVERDUE' ? 'danger' : 'info'}>{statuses[action.status] ?? action.status}</Badge>
    </div>
    <p className="text-lg font-semibold">{action.title}</p>
    <dl className="grid gap-2 text-sm sm:grid-cols-3">
      <div><dt className="text-muted">Ответственный</dt><dd>{action.assignee?.fullName || 'Не указано'}</dd></div>
      <div><dt className="text-muted">Срок действия</dt><dd>{workingDate(action.dueAt)}</dd></div>
      <div><dt className="text-muted">Напоминание</dt><dd>{workingDate(action.reminderAt)}</dd></div>
    </dl>
    <Button variant="ghost" onClick={history}>История закупки</Button>
  </Card>;
}
