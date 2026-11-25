'use client';

import Image from 'next/image';
import { useState } from 'react';
import { API_BASE_URL, apiFetch } from '@/lib/api-client';
import { reportTimeZone, useCoreResource } from '@/lib/discovery';
import { useSession } from '@/app/components/AuthGate';
import { StatusBadge } from '@/app/components/StatusBadge';
import { Button, Field, Textarea } from '@/app/components/ui';

type RequestItem = {
  id: string;
  name: string;
  partNumber: string | null;
  quantity: string | number;
  unit: string;
  notes: string | null;
  sortOrder: number;
  photoPath: string | null;
  photoOriginalName: string | null;
  photoMimeType: string | null;
};

type RequestUser = {
  id: string;
  fullName: string;
  username: string;
};

type RequestHistory = {
  id: string;
  actorName: string | null;
  action: string;
  comment: string | null;
  createdAt: string;
};

const historyLabels: Record<string, string> = {
  CREATED: 'Заявка создана',
  START_REVIEW: 'Начато рассмотрение',
  REJECTED: 'Заявка отклонена',
  ACCEPTED: 'Создана закупка',
};

type RequestAction = 'review' | 'accept' | 'reject';

export type PurchaseRequest = {
  id: string;
  number: number;
  requesterName: string | null;
  requester: RequestUser | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  notes: string | null;
  createdAt: string;
  requiredAt?: string | null;
  assignedTo?: RequestUser | null;
  decisionComment?: string | null;
  history?: RequestHistory[];
  items?: RequestItem[];
  _count?: { items: number };
  task: {
    id: string;
    number: number;
    title: string;
    status: string;
  } | null;
};


function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: reportTimeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function requesterLabel(request: PurchaseRequest) {
  return (
    request.requesterName?.trim() ||
    request.requester?.fullName ||
    'Не указан'
  );
}

function getErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const message = (data as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('. ');
  if (typeof message === 'string') return message;
  return fallback;
}


export default function RequestCard({
  request,
  onAccepted,
  onUpdated = onAccepted,
  initiallyExpanded = false,
}: {
  request: PurchaseRequest;
  onAccepted: () => void;
  onUpdated?: () => void;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [busyAction, setBusyAction] = useState<RequestAction | null>(null);
  const [actionError, setActionError] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [reason, setReason] = useState('');

  const { user } = useSession();
  const canManage = user.role !== 'EMPLOYEE';
  const details = useCoreResource<PurchaseRequest>(expanded && !request.items
    ? `/purchase-requests/${request.id}` : null);
  const fullRequest = details.data ?? request;
  const itemCount = request._count?.items ?? request.items?.length ?? 0;

  const mayProcess = canManage && !details.loading && !details.error && !fullRequest.task &&
    (!fullRequest.assignedTo || fullRequest.assignedTo.id === user.id || user.role === 'ADMIN');
  const mayReject = mayProcess && ['NEW', 'IN_REVIEW', 'NEEDS_CLARIFICATION'].includes(fullRequest.status);
  const mayAccept = mayProcess && (mayReject || fullRequest.status === 'APPROVED');

  async function handleAction(action: RequestAction) {
    if (busyAction || (action === 'reject' && reason.trim().length < 5)) return;
    setBusyAction(action);
    setActionError('');
    try {
      const response = await apiFetch(`/purchase-requests/${request.id}/${action}`, {
        method: 'PATCH',
        ...(action === 'reject' ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        } : {}),
      });
      if (!response.ok) {
        const data: unknown = await response.json().catch(() => null);
        throw new Error(getErrorMessage(data, 'Не удалось обработать заявку'));
      }
      if (action === 'accept') onAccepted();
      else onUpdated();
      void details.reload();
      setShowRejectForm(false);
      setReason('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось обработать заявку');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-4 p-4 text-left sm:p-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-950">
              Заявка №{request.number}
            </span>
            <StatusBadge status={request.status} kind="request" />
          </div>
          <div className="mt-2 text-base font-semibold text-slate-900">
            {request.title}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {requesterLabel(request)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>{formatDateTime(request.createdAt)}</span>
            <span>
              {itemCount}{' '}
              {itemCount === 1 ? 'позиция' : 'позиций'}
            </span>
          </div>
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={`mt-1 h-5 w-5 shrink-0 text-slate-400 transition ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
          <div className="space-y-3">
            {details.loading && <p role="status">Загружаем позиции…</p>}
            {details.error && (
              <div role="alert" className="text-sm text-rose-700">
                {details.error}
                <button type="button" className="ml-2 underline" onClick={() => void details.reload()}>Повторить</button>
              </div>
            )}
            {fullRequest.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{fullRequest.description}</p>}
            {fullRequest.items?.map((item, index) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 sm:p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-400">
                      Позиция {index + 1}
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {item.name}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                    {String(item.quantity)} {item.unit}
                  </div>
                </div>

                {item.notes && (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                    {item.notes}
                  </p>
                )}

                {item.photoPath && (
                  <a
                    href={`${API_BASE_URL}/purchase-requests/public/items/${item.id}/photo`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 transition hover:border-blue-200 hover:bg-blue-50/40"
                  >
                    <Image
                      unoptimized
                      width={64}
                      height={64}
                      crossOrigin="use-credentials"
                      src={`${API_BASE_URL}/purchase-requests/public/items/${item.id}/photo`}
                      alt={`Фото: ${item.name}`}
                      className="h-16 w-16 rounded-lg bg-slate-100 object-cover"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-700">
                        Открыть фотографию
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-400">
                        {item.photoOriginalName ?? 'Фото позиции'}
                      </div>
                    </div>
                  </a>
                )}
              </div>
            ))}
          </div>

          {fullRequest.requiredAt && <p className="mt-3 text-sm">Требуется до {formatDateTime(fullRequest.requiredAt)}</p>}
          {fullRequest.assignedTo && <p className="mt-2 text-sm">На рассмотрении у {fullRequest.assignedTo.fullName}</p>}
          {fullRequest.decisionComment && <p className="mt-3 whitespace-pre-wrap text-sm">{fullRequest.decisionComment}</p>}

          {canManage && fullRequest.task && (
            <a href={`/tasks/${fullRequest.task.id}`} className="ui-button ui-button--primary mt-4">
              Перейти к закупке №{fullRequest.task.number}
            </a>
          )}
          {(mayAccept || mayReject) && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap gap-2">
                {fullRequest.status === 'NEW' && <Button variant="outline" disabled={busyAction !== null}
                  onClick={() => void handleAction('review')}>Взять на рассмотрение</Button>}
                {mayAccept && <Button disabled={busyAction !== null}
                  onClick={() => void handleAction('accept')}>Принять и создать закупку</Button>}
                {mayReject && <Button variant="outline" disabled={busyAction !== null}
                  onClick={() => { setActionError(''); setShowRejectForm(value => !value); }}>
                  {showRejectForm ? 'Отмена отказа' : 'Отклонить'}
                </Button>}
              </div>
              {showRejectForm && mayReject && <div className="space-y-2">
                <Field id={`reject-reason-${request.id}`} label="Причина отклонения заявки">
                  <Textarea id={`reject-reason-${request.id}`} value={reason}
                    onChange={event => setReason(event.target.value)} maxLength={1500} rows={3} />
                </Field>
                <Button disabled={busyAction !== null || reason.trim().length < 5}
                  onClick={() => void handleAction('reject')}>Подтвердить отклонение</Button>
              </div>}
            </div>
          )}
          {actionError && <p role="alert" className="mt-3 text-sm text-rose-700">{actionError}</p>}

          {fullRequest.history && <section className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold">История заявки</h3>
            {fullRequest.history.length ? <ol className="mt-3 space-y-2">
              {fullRequest.history.map(entry => (
                <li key={entry.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                  <span className="font-semibold">{historyLabels[entry.action] ?? entry.action}</span>
                  <p className="text-muted">{entry.actorName ?? 'Система'} · {formatDateTime(entry.createdAt)}</p>
                  {entry.comment && <p className="mt-1 whitespace-pre-wrap">{entry.comment}</p>}
                </li>
              ))}
            </ol> : <p className="mt-2 text-sm text-muted">История действий пока отсутствует.</p>}
          </section>}
        </div>
      )}
    </article>
  );
}
