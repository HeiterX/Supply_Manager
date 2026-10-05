'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

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

const statusLabels: Record<string, string> = {
  NEW: 'Новая',
  ACCEPTED: 'Принята',
  APPROVED: 'Принята',
  IN_PROGRESS: 'В работе',
  CONVERTED: 'Передана в закупку',
  REJECTED: 'Отклонена',
  CANCELLED: 'Отменена',
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

function getErrorMessage(data: unknown, fallback: string) {
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
  const [authRequired, setAuthRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [search, setSearch] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);

  async function loadRequests() {
    setLoading(true);
    setError('');
    setForbidden(false);

    try {
      const response = await fetch(`${API_URL}/purchase-requests`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (response.status === 401) {
        setAuthRequired(true);
        setRequests([]);
        return;
      }

      if (response.status === 403) {
        setAuthRequired(false);
        setForbidden(true);
        setRequests([]);
        return;
      }

      const data = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, 'Не удалось загрузить заявки'),
        );
      }

      if (!Array.isArray(data)) {
        throw new Error('Сервер вернул некорректный список заявок');
      }

      setRequests(data as PurchaseRequest[]);
      setAuthRequired(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось загрузить заявки',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequests();
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, 'Не удалось выполнить вход'),
        );
      }

      setPassword('');
      setAuthRequired(false);

      await loadRequests();
    } catch (loginRequestError) {
      setLoginError(
        loginRequestError instanceof Error
          ? loginRequestError.message
          : 'Не удалось выполнить вход',
      );
    } finally {
      setLoginLoading(false);
    }
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

  const newCount = requests.filter(
    (request) => request.status === 'NEW',
  ).length;

  const positionsCount = requests.reduce(
    (sum, request) => sum + request.items.length,
    0,
  );

  if (authRequired) {
    return (
      <AppShell
        title="Входящие заявки"
        subtitle="Заявки сотрудников на закупку"
      >
        <div className="mx-auto max-w-md pt-6 sm:pt-12">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-6 w-6"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </div>

            <h2 className="mt-5 text-xl font-semibold tracking-tight">
              Вход для сотрудника снабжения
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Входящие заявки доступны сотрудникам с ролью PROCUREMENT
              или ADMIN.
            </p>

            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Логин
                </span>

                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                  className="h-12 w-full rounded-xl border border-slate-200 px-4 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Пароль
                </span>

                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  className="h-12 w-full rounded-xl border border-slate-200 px-4 text-base outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </label>

              {loginError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loginLoading ? 'Входим…' : 'Войти'}
              </button>
            </form>
          </section>
        </div>
      </AppShell>
    );
  }

  if (forbidden) {
    return (
      <AppShell
        title="Входящие заявки"
        subtitle="Заявки сотрудников на закупку"
      >
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-950">
            Недостаточно прав
          </h2>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-amber-800">
            Аккаунт успешно авторизован, но для просмотра всех заявок
            нужна роль PROCUREMENT или ADMIN.
          </p>
        </div>
      </AppShell>
    );
  }

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

          <h2 className="mt-4 font-semibold text-slate-800">
            Заявок не найдено
          </h2>

          <p className="mt-1 text-sm text-slate-400">
            Попробуйте изменить фильтр или строку поиска.
          </p>
        </section>
      ) : (
        <div className="mt-5 space-y-4">
          {filteredRequests.map((request) => (
            <RequestCard key={request.id} request={request} />
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

      <div className="mt-1 text-xs font-medium text-slate-400">
        {label}
      </div>
    </div>
  );
}

function RequestCard({ request }: { request: PurchaseRequest }) {
  const [expanded, setExpanded] = useState(request.status === 'NEW');

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
                    href={`${API_URL}/purchase-requests/public/items/${item.id}/photo`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 transition hover:border-blue-200 hover:bg-blue-50/40"
                  >
                    <img
                      src={`${API_URL}/purchase-requests/public/items/${item.id}/photo`}
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
            <a
              href={`/tasks/${request.task.id}`}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 sm:ml-auto sm:w-auto sm:px-5"
            >
              Перейти к закупке №{request.task.number}
            </a>
          ) : (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-400">
                Следующий этап — принятие заявки и создание закупки.
              </p>

              <button
                type="button"
                disabled
                title="Подключим на следующем этапе"
                className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white opacity-50"
              >
                Принять в работу
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
