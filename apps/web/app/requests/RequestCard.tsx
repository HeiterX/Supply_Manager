'use client';

import Image from 'next/image';
import { useState } from 'react';
import { API_BASE_URL, apiFetch } from '../../lib/api-client';
import { reportTimeZone, statusLabels, useCoreResource } from '../../lib/discovery';
import { useCurrentUser } from '../components/AuthGate';

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
  items?: RequestItem[];
  _count?: { items: number };
  task: {
    id: string;
    number: number;
    title: string;
    status: string;
  } | null;
};


const statusStyles: Record<string, string> = {
  NEW: 'bg-blue-50 text-blue-700 ring-blue-100',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 ring-violet-100',
  CONVERTED: 'bg-violet-50 text-violet-700 ring-violet-100',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-100',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
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
  initiallyExpanded = false,
}: {
  request: PurchaseRequest;
  onAccepted: () => void;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  const canManage = useCurrentUser()?.role !== 'EMPLOYEE';
  const details = useCoreResource<PurchaseRequest>(expanded && !request.items
    ? `/purchase-requests/${request.id}` : null);
  const fullRequest = details.data ?? request;
  const itemCount = request._count?.items ?? request.items?.length ?? 0;

  async function handleAccept() {
    if (accepting) return;
    setAccepting(true);
    setAcceptError('');

    try {
      const response = await apiFetch(
        `/purchase-requests/${request.id}/accept`,
        { method: 'PATCH' },
      );

      if (response.status === 401) {
        throw new Error('Сессия истекла. Войдите повторно.');
      }
      if (response.status === 403) {
        throw new Error('Недостаточно прав для принятия заявки.');
      }

      const data = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(data, 'Не удалось принять заявку в работу'));
      }

      onAccepted();
      void details.reload();
    } catch (requestError) {
      setAcceptError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось принять заявку в работу',
      );
    } finally {
      setAccepting(false);
    }
  }

  const statusClass =
    statusStyles[request.status] ??
    'bg-slate-100 text-slate-600 ring-slate-200';

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
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${statusClass}`}
            >
              {statusLabels[request.status] ?? request.status}
            </span>
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

          {canManage && fullRequest.task ? (
            <a
              href={`/tasks/${fullRequest.task.id}`}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 sm:ml-auto sm:w-auto sm:px-5"
            >
              Перейти к закупке №{fullRequest.task.number}
            </a>
          ) : canManage && !details.loading && !details.error && ['NEW', 'IN_REVIEW', 'NEEDS_CLARIFICATION', 'APPROVED'].includes(request.status) ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-400">
                Следующий этап — принятие заявки и создание закупки.
              </p>
              <div className="sm:text-right">
                <button
                  type="button"
                  onClick={() => void handleAccept()}
                  disabled={accepting}
                  className="h-11 w-full rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {accepting ? 'Принимаем...' : 'Принять в работу'}
                </button>
                {acceptError && (
                  <p className="mt-2 max-w-sm text-sm leading-5 text-red-600">
                    {acceptError}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
