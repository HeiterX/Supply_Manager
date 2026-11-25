'use client';

import Image from 'next/image';
import { useCallback, useMemo, useState } from 'react';
import { useAbortableLoad } from '../../lib/use-abortable-load';
import AppShell from '../components/AppShell';
import AuthGate from '../components/AuthGate';
import { API_BASE_URL, apiFetch } from '../../lib/api-client';

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
  fromStatus: string | null;
  toStatus: string;
  comment: string | null;
  createdAt: string;
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
  requiredAt: string | null;
  notes: string | null;
  assignedTo: RequestUser | null;
  processedBy: RequestUser | null;
  decisionComment: string | null;
  history: RequestHistory[];
  createdAt: string;
  items: RequestItem[];
  task: {
    id: string;
    number: number;
    title: string;
    status: string;
  } | null;
};

const statusLabels: Record<string, string> = {
  NEW: 'Новая',
  IN_REVIEW: 'На рассмотрении',
  NEEDS_CLARIFICATION: 'Требует уточнения',
  ACCEPTED: 'Принята',
  APPROVED: 'Принята',
  IN_PROGRESS: 'В работе',
  CONVERTED: 'Передана в закупку',
  REJECTED: 'Отклонена',
  CANCELLED: 'Отменена',
};

const statusStyles: Record<string, string> = {
  NEW: 'bg-blue-50 text-blue-700 ring-blue-100',
  IN_REVIEW: 'bg-amber-50 text-amber-700 ring-amber-100',
  NEEDS_CLARIFICATION: 'bg-orange-50 text-orange-700 ring-orange-100',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 ring-violet-100',
  CONVERTED: 'bg-violet-50 text-violet-700 ring-violet-100',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-100',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const priorityLabels: Record<string, string> = {
  LOW: 'Низкий',
  NORMAL: 'Обычный',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};

const priorityStyles: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-600',
  NORMAL: 'bg-slate-100 text-slate-700',
  HIGH: 'bg-amber-50 text-amber-700',
  URGENT: 'bg-rose-50 text-rose-700',
};

function formatRequestDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

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

function RequestsContent() {
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

      // AuthGate получает событие от apiFetch и скрывает защищённую страницу.
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
    <AppShell
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
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Номер, сотрудник или позиция"
              className="h-11 w-full rounded-xl border border-slate-200 pl-11 pr-4 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
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
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-5 grid gap-4">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-48 animate-pulse rounded-3xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      ) : filteredRequests.length === 0 ? (
        <section className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-6 w-6"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M5 4h14v16H5z" />
              <path d="M8 9h8M8 13h5" />
            </svg>
          </div>
          <h2 className="mt-4 font-semibold text-slate-800">Заявок не найдено</h2>
          <p className="mt-1 text-sm text-slate-400">
            Попробуйте изменить фильтр или строку поиска.
          </p>
        </section>
      ) : (
        <div className="mt-5 space-y-4">
          {filteredRequests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onUpdated={(updatedRequest) => {
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
    </AppShell>
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
  onUpdated,
}: {
  request: PurchaseRequest;
  onUpdated: (request: PurchaseRequest) => void;
}) {
  const [expanded, setExpanded] = useState(request.status === 'NEW');
  const [busyAction, setBusyAction] = useState<
    'review' | 'accept' | 'reject' | null
  >(null);
  const [actionError, setActionError] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [reason, setReason] = useState('');

  const canAccept =
    !request.task &&
    ['NEW', 'IN_REVIEW', 'NEEDS_CLARIFICATION', 'APPROVED'].includes(
      request.status,
    );

  const canReject =
    !request.task &&
    ['NEW', 'IN_REVIEW', 'NEEDS_CLARIFICATION'].includes(
      request.status,
    );

  async function handleAction(
    action: 'review' | 'accept' | 'reject',
  ) {
    if (busyAction) return;

    if (action === 'reject' && reason.trim().length < 5) {
      setActionError('Укажите причину отказа: минимум 5 символов.');
      return;
    }

    setBusyAction(action);
    setActionError('');

    try {
      const options: RequestInit = {
        method: 'PATCH',
      };

      if (action === 'reject') {
        options.headers = {
          'Content-Type': 'application/json',
        };
        options.body = JSON.stringify({
          reason: reason.trim(),
        });
      }

      const response = await apiFetch(
        `/purchase-requests/${request.id}/${action}`,
        options,
      );

      if (response.status === 401) {
        throw new Error('Сессия истекла. Войдите повторно.');
      }

      const data: unknown = await response
        .json()
        .catch(() => null);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, 'Не удалось обработать заявку'),
        );
      }

      if (
        !data ||
        typeof data !== 'object' ||
        !('id' in data)
      ) {
        throw new Error('Сервер вернул некорректный ответ');
      }

      onUpdated(data as PurchaseRequest);
      setShowRejectForm(false);
      setReason('');
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Не удалось обработать заявку',
      );
    } finally {
      setBusyAction(null);
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
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                priorityStyles[request.priority] ??
                'bg-slate-100 text-slate-700'
              }`}
            >
              {priorityLabels[request.priority] ?? request.priority}
            </span>
          </div>
          <div className="mt-2 text-base font-semibold text-slate-900">
            {requesterLabel(request)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>{formatDateTime(request.createdAt)}</span>
            <span>
              {request.requiredAt
                ? `Необходимо до: ${formatRequestDate(request.requiredAt)}`
                : 'Срок не указан'}
            </span>
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

          {request.assignedTo && (
            <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Ответственный: <strong>{request.assignedTo.fullName}</strong>
            </div>
          )}

          {request.status === 'REJECTED' && request.decisionComment && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-sm font-semibold text-rose-800">
                Причина отказа
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700">
                {request.decisionComment}
              </p>
              {request.processedBy && (
                <p className="mt-2 text-xs text-rose-600">
                  Решение: {request.processedBy.fullName}
                </p>
              )}
            </div>
          )}

          {request.task && (
            <a
              href={`/tasks/${request.task.id}`}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 sm:ml-auto sm:w-auto sm:px-5"
            >
              Перейти к закупке №{request.task.number}
            </a>
          )}

          {(canAccept || canReject) && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap gap-2">
                {request.status === 'NEW' && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleAction('review')}
                    className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                  >
                    {busyAction === 'review'
                      ? 'Назначаем...'
                      : 'Взять на рассмотрение'}
                  </button>
                )}

                {canAccept && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleAction('accept')}
                    className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busyAction === 'accept'
                      ? 'Создаём закупку...'
                      : 'Принять и создать закупку'}
                  </button>
                )}

                {canReject && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => {
                      setActionError('');
                      setShowRejectForm((value) => !value);
                    }}
                    className="min-h-11 rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    {showRejectForm
                      ? 'Отмена отказа'
                      : 'Отклонить'}
                  </button>
                )}
              </div>

              {showRejectForm && canReject && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
                  <label
                    htmlFor={`reject-reason-${request.id}`}
                    className="block text-sm font-semibold text-slate-800"
                  >
                    Причина отклонения заявки
                  </label>

                  <textarea
                    id={`reject-reason-${request.id}`}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    minLength={5}
                    maxLength={1500}
                    rows={3}
                    placeholder="Например: требуется уточнить технические характеристики комплектующих"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-rose-400"
                  />

                  <p className="mt-1 text-xs text-slate-500">
                    Минимум 5 символов. Причина будет доступна автору заявки.
                  </p>

                  <button
                    type="button"
                    disabled={busyAction !== null || reason.trim().length < 5}
                    onClick={() => void handleAction('reject')}
                    className="mt-3 min-h-11 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === 'reject'
                      ? 'Отклоняем...'
                      : 'Подтвердить отклонение'}
                  </button>
                </div>
              )}

              {actionError && (
                <p role="alert" className="text-sm text-rose-600">
                  {actionError}
                </p>
              )}
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">
              История заявки
            </h3>

            {request.history?.length ? (
              <ol className="mt-3 space-y-3">
                {request.history.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-xl bg-slate-50 px-3 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">
                        {({
                          CREATED: 'Заявка создана',
                          START_REVIEW: 'Начато рассмотрение',
                          REJECTED: 'Заявка отклонена',
                          ACCEPTED: 'Создана закупка',
                        } as Record<string, string>)[entry.action] ??
                          entry.action}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {entry.actorName ?? 'Система'}
                    </p>
                    {entry.comment && (
                      <p className="mt-2 whitespace-pre-wrap text-slate-700">
                        {entry.comment}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-slate-400">
                История действий пока отсутствует.
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export default function RequestsPage() {
  return (
    <AuthGate>
      <RequestsContent />
    </AuthGate>
  );
}
