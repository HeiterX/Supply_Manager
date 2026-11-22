'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { apiFetch } from './api-client';
import { useAbortableLoad } from './use-abortable-load';

type ListPage<T> = { items: T[]; total: number; page: number; pageSize: number; hasPrevious: boolean; hasNext: boolean };
type Result<T> = { key: string; page?: ListPage<T>; legacy?: boolean; error?: string };
type Entity = 'tasks' | 'requests';
export const viewKeys = ['view', 'status', 'overdue', 'delivery', 'priority', 'sort', 'direction', 'pageSize'] as const;
const queryKeys = ['q', ...viewKeys, 'page', 'supplier', 'payment', 'hasOrders', 'createdFrom', 'createdTo', 'deadlineFrom', 'deadlineTo'];

export async function workingError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { message?: unknown } | null;
  if (response.status === 403) return 'Недостаточно прав для этой операции.';
  if (response.status === 401) return 'Сессия истекла. Войдите повторно.';
  const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export function useWorkingList<T>(entity: Entity) {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = new URLSearchParams();
  for (const key of queryKeys) {
    const value = search.get(key);
    if (value) query.set(key, value);
  }
  const key = query.toString();
  const [result, setResult] = useState<Result<T>>();
  const [retry, setRetry] = useState(0);
  const requestKey = `${retry}:${key}`;
  const knownLegacy = result?.legacy === true;
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      let response = await apiFetch(`/discovery/lists/${entity}?${key}`, { signal, cache: 'no-store' });
      const legacy = response.status === 404;
      if (legacy) response = await apiFetch(entity === 'tasks' ? '/tasks' : '/purchase-requests', { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(await workingError(response, 'Не удалось загрузить список.'));
      const data: T[] | ListPage<T> = await response.json();
      const page = Array.isArray(data)
        ? { items: data, total: data.length, page: 1, pageSize: data.length, hasPrevious: false, hasNext: false }
        : data;
      if (!signal.aborted) setResult({ key: requestKey, page, legacy });
    } catch (error) {
      if (!signal.aborted) setResult({ key: requestKey, error: error instanceof TypeError
        ? 'Сервер недоступен. Проверьте подключение.' : error instanceof Error ? error.message : 'Не удалось загрузить список.' });
    }
  }, [entity, key, requestKey]);
  useAbortableLoad(load);

  function change(next: URLSearchParams) {
    if (next.toString() !== key) window.history.pushState(null, '', next.size ? `${pathname}?${next}` : pathname);
  }

  const current = result?.key === requestKey;
  return {
    page: result?.page,
    error: current ? result?.error : undefined,
    loading: !current,
    legacy: knownLegacy,
    query,
    change,
    href: key ? `${pathname}?${key}` : pathname,
    reload: () => setRetry((value) => value + 1),
  };
}

export type WorkingList = ReturnType<typeof useWorkingList<unknown>>;

export const priorityLabels: Record<string, string> = {
  LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', URGENT: 'Срочный',
};

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'Europe/Moscow' });
export function workingDate(value?: string | null) {
  return value ? dateFormat.format(new Date(value)) : 'Не указано';
}

export function workingBack(value: string | null) {
  if (!value || !/^\/(?:\?|requests(?:\?|$)|registry(?:\?|$)|orders(?:\?|$)|analytics(?:\?|$)|suppliers\/[a-z\d-]+(?:\?|$)|$)/i.test(value)
    || /[\\\u0000-\u0020]/u.test(value)) return '/';
  return value;
}

export function workingLink(path: string, back: string) {
  return `${path}?${new URLSearchParams({ back })}`;
}
