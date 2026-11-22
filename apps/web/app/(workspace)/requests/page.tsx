'use client';

import { Input } from '@/app/components/ui';

import Link from 'next/link';
import { StatusBadge } from '@/app/components/StatusBadge';
import Image from 'next/image';
import { useCallback, useMemo, useState } from 'react';
import { useAbortableLoad } from '@/lib/use-abortable-load';
import { Alert, EmptyState, Skeleton } from '@/app/components/ui';
import PageLayout from '@/app/components/PageLayout';
import { API_BASE_URL, apiFetch } from '@/lib/api-client';

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

type PurchaseRequest = {
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
  items: RequestItem[];
  task: {
    id: string;
    number: number;
    title: string;
    status: string;
  } | null;
};



function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
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

export default function RequestsPage() {
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);

  const fetchRequests = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await apiFetch('/purchase-requests', {
        cache: 'no-store',
        signal,
      });
      if (signal.aborted) return;

      // Оболочка обрабатывает отказ в доступе и скрывает защищённый список.
      if (response.status === 401 || response.status === 403) {
        setRequests([]);
        return;
      }

      const data = (await response.json().catch(() => null)) as unknown;
      if (signal.aborted) return;

      if (!response.ok) {
        throw new Error(getErrorMessage(data, 'Не удалось загрузить заявки'));
      }

      if (!Array.isArray(data)) {
        throw new Error('Сервер вернул некорректный список заявок');
      }

      setRequests(data as PurchaseRequest[]);
      setError('');
    } catch (requestError) {
      if (signal.aborted) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось загрузить заявки',
      );
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  const reloadRequests = useAbortableLoad(fetchRequests);

  function loadRequests() {
    setLoading(true);
    setError('');
    return reloadRequests();
  }

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase();

    return requests.filter((request) => {
      if (onlyNew && request.status !== 'NEW') return false;
      if (!query) return true;

      const haystack = [
        String(request.number),
        requesterLabel(request),
        request.title,
        ...request.items.map((item) => item.name),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [requests, search, onlyNew]);

  const newCount = requests.filter((request) => request.status === 'NEW').length;
  const positionsCount = requests.reduce(
    (sum, request) => sum + request.items.length,
    0,
  );

  return (
    <PageLayout
      title="Входящие заявки"
      subtitle="Заявки сотрудников, ожидающие обработки отделом снабжения"
      action={
        <button
          type="button"
          onClick={() => void loadRequests()}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          Обновить
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Новых" value={newCount} accent />
        <StatCard label="Всего заявок" value={requests.length} />
        <StatCard label="Позиций" value={positionsCount} />
      </div>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 4 4" />
            </svg>
            <Input
              type="search"
              aria-label="Поиск входящих заявок"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Номер, сотрудник или позиция"
              className="pl-9"
            />
          </div>

          <button
            type="button"
            onClick={() => setOnlyNew((value) => !value)}
            className={`h-11 rounded-xl px-4 text-sm font-medium transition ${
              onlyNew
                ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {onlyNew ? 'Только новые' : 'Все статусы'}
          </button>
        </div>
      </section>

      {error && (
        <div className="mb-4"><Alert tone="danger">{error}</Alert></div>
      )}

      {loading ? (
        <Skeleton label="Загружаем заявки" />
      ) : filteredRequests.length === 0 ? (
        <EmptyState title="Заявок не найдено" description="Попробуйте изменить фильтр или строку поиска." />
      ) : (
        <div className="mt-5 space-y-4">
          {filteredRequests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onAccepted={(updatedRequest) => {
                setRequests((current) =>
                  current.map((item) =>
                    item.id === updatedRequest.id ? updatedRequest : item,
                  ),
                );
                // После принятия статус меняется; показываем и не-новые заявки.
                setOnlyNew(false);
              }}
            />
          ))}
        </div>
      )}
    </PageLayout>
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div
        className={`text-2xl font-semibold tracking-tight ${
          accent ? 'text-blue-600' : 'text-slate-950'
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs font-medium text-slate-400">{label}</div>
    </div>
  );
}

function RequestCard({
  request,
  onAccepted,
}: {
  request: PurchaseRequest;
  onAccepted: (request: PurchaseRequest) => void;
}) {
  const [expanded, setExpanded] = useState(request.status === 'NEW');
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');

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

      onAccepted(data as PurchaseRequest);
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
            {requesterLabel(request)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>{formatDateTime(request.createdAt)}</span>
            <span>
              {request.items.length}{' '}
              {request.items.length === 1 ? 'позиция' : 'позиций'}
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
            {request.items.map((item, index) => (
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

          {request.task ? (
            <Link
              href={`/tasks/${request.task.id}`}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 sm:ml-auto sm:w-auto sm:px-5"
            >
              Перейти к закупке №{request.task.number}
            </Link>
          ) : (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-400">
                Следующий этап — принятие заявки и создание закупки.
              </p>
              <div className="sm:text-right">
                <button
                  type="button"
                  onClick={() => void handleAccept()}
                  disabled={accepting}
                  className="ui-button ui-button--primary h-11 w-full px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
          )}
        </div>
      )}
    </article>
  );
}
