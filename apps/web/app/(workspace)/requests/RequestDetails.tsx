'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import LoadError from '@/app/components/LoadError';
import { StatusBadge } from '@/app/components/StatusBadge';
import { Alert, Badge, Button, Card, EmptyState, Skeleton, Spinner } from '@/app/components/ui';
import { apiFetch } from '@/lib/api-client';
import { apiError, apiMessage, apiProblem, ApiError, couldHaveSaved } from '@/lib/api-error';
import { useAbortableLoad } from '@/lib/use-abortable-load';
import { useRetryDelay } from '@/lib/use-retry-delay';
import { priorityLabels, workingDate, workingLink } from '@/lib/working-list';

type Person = { fullName: string; department?: string | null };
type RequestItem = {
  id: string; name: string; partNumber: string | null; quantity: number | string; unit: string;
  notes: string | null; photoPath: string | null; photoOriginalName: string | null;
};
export type RequestRow = {
  id: string; number: number; title: string; status: string; priority: string; createdAt: string;
  requesterName: string | null; requester: Person | null; processedBy?: Person | null;
  _count?: { items: number }; items?: RequestItem[];
};
type Request = RequestRow & {
  items: RequestItem[]; description: string | null; notes: string | null; requiredAt: string | null;
  processedAt: string | null; decisionComment: string | null; task: { id: string; number: number } | null;
};

export function requester(request: RequestRow) {
  return request.requesterName?.trim() || request.requester?.fullName || 'Не указан';
}

function RequestPhoto({ item }: { item: RequestItem }) {
  const [result, setResult] = useState<{ url?: string; error?: string | ApiError }>();
  const [attempt, setAttempt] = useState(0);
  const name = item.photoOriginalName || 'Фото позиции';
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    let url: string | undefined;
    async function load() {
      try {
        const response = await apiFetch(`/purchase-requests/public/items/${encodeURIComponent(item.id)}/photo`,
          { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw await apiError(response, 'Не удалось открыть фото.');
        const blob = await response.blob();
        if (!/^image\/(jpeg|png|webp)$/i.test(blob.type)) throw new Error('Сервер вернул неподдерживаемый формат фото.');
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ url });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ error: apiProblem(error, 'Не удалось открыть фото.') });
      }
    }
    void load();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [attempt, item.id]);

  if (result?.url) return <div className="mt-3 space-y-2">
    <Image unoptimized src={result.url} alt={`Фото: ${item.name}`} width={640} height={480}
      className="max-h-96 w-full rounded-lg bg-surface-subtle object-contain" />
    <a className="ui-button ui-button--outline whitespace-normal [overflow-wrap:anywhere]" href={result.url} download={name}>{name} · Скачать</a>
  </div>;
  function retry() {
      setResult(undefined); setAttempt((value) => value + 1);
  }
  return <div className="mt-3">{result?.error ? <LoadError message={result.error} retry={retry} retryLabel="Повторить загрузку фото" />
    : <Button variant="outline" loading={attempt > 0 && !result} onClick={retry}>Показать фото</Button>}</div>;
}

export default function RequestDetails({ id, back, onChanged }: { id: string; back: string; onChanged?: () => void }) {
  const [request, setRequest] = useState<Request>();
  const [error, setError] = useState<string | ApiError>('');
  const [action, setAction] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const waiting = useRetryDelay(retryAt);
  const lock = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await apiFetch(`/purchase-requests/${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
      if (!response.ok) throw await apiError(response, 'Не удалось открыть заявку.');
      const value = await response.json() as Request;
      if (!signal.aborted) { setRequest(value); setError(''); }
    } catch (error) {
      if (!signal.aborted) setError(apiProblem(error, 'Не удалось открыть заявку.'));
    }
  }, [id]);
  const reload = useAbortableLoad(load);

  async function accept() {
    if (lock.current || waiting) return;
    lock.current = true;
    setBusy(true);
    setAction('');
    try {
      const response = await apiFetch(`/purchase-requests/${encodeURIComponent(id)}/accept`, { method: 'PATCH' });
      if (response.status === 409) {
        await reload();
        onChanged?.();
        setAction('Заявка изменилась. Данные обновлены.');
        return;
      }
      if (!response.ok) throw await apiError(response, 'Не удалось принять заявку.');
      setRequest(await response.json() as Request);
      setAccepted(true);
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiError) setRetryAt(error.retryAt);
      if (couldHaveSaved(error)) {
        setAction('Подтверждение не получено. Проверьте актуальное состояние заявки.');
        await reload();
      } else setAction(apiMessage(error, 'Не удалось принять заявку.'));
    } finally { lock.current = false; setBusy(false); }
  }

  if (error) return <LoadError message={error} retry={() => void reload()} back={back} />;
  if (!request) return <Skeleton label="Загрузка заявки" />;
  return <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2"><Badge>№{request.number}</Badge>
        <StatusBadge status={request.status} kind="request" /><Badge>{priorityLabels[request.priority] ?? request.priority}</Badge></div>
      <h3 className="text-lg font-semibold">{request.title}</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Заявитель</dt><dd>{requester(request)}</dd></div>
        {request.requester?.department && <div><dt className="text-muted">Подразделение</dt><dd>{request.requester.department}</dd></div>}
        <div><dt className="text-muted">Создана</dt><dd>{workingDate(request.createdAt)}</dd></div>
        <div><dt className="text-muted">Требуемый срок</dt><dd>{workingDate(request.requiredAt)}</dd></div>
        <div><dt className="text-muted">Обработал</dt><dd>{request.processedBy?.fullName || 'Не указано'}</dd></div>
      </dl>
      {request.description && <p className="whitespace-pre-wrap text-sm">{request.description}</p>}
      {request.notes && <p className="whitespace-pre-wrap text-sm">{request.notes}</p>}
      {request.task
        ? <Link className="ui-button ui-button--outline" href={workingLink(`/tasks/${request.task.id}`, back)}>Закупка №{request.task.number}</Link>
        : !['REJECTED', 'CANCELLED'].includes(request.status) && <Button loading={busy} disabled={waiting} onClick={() => void accept()}>Принять в работу</Button>}
      {accepted && <Alert tone="success">Заявка принята в работу.</Alert>}
      {action && <Alert tone="danger">{action}</Alert>}
      {busy && <span className="sr-only"><Spinner /> Обрабатываем заявку</span>}
    </Card>
    <h3 className="font-semibold">Позиции · {request.items.length}</h3>
    {request.items.length ? request.items.map((item) => <Card key={item.id} className="p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h4 className="min-w-0 font-medium">{item.name}</h4><Badge>{item.quantity} {item.unit}</Badge>
      </div>
      {item.partNumber && <p className="mt-1 text-sm text-muted">Артикул {item.partNumber}</p>}
      {item.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{item.notes}</p>}
      {item.photoPath && <RequestPhoto item={item} />}
    </Card>) : <EmptyState title="В заявке нет позиций" />}
    <Card className="space-y-2 p-4">
      <h3 className="font-semibold">Обработка заявки</h3>
      {request.processedAt ? <p className="text-sm">{workingDate(request.processedAt)} · {request.processedBy?.fullName ?? 'Ответственный не указан'}</p>
        : <p className="text-sm text-muted">Данные об обработке пока отсутствуют.</p>}
      {request.decisionComment && <p className="whitespace-pre-wrap text-sm">{request.decisionComment}</p>}
    </Card>
  </div>;
}
