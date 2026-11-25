'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { apiFetch } from './api-client';
import { apiError, apiProblem, type ApiError } from './api-error';
import { useAbortableLoad } from './use-abortable-load';

type ListPage<T> = { items: T[]; total: number; page: number; pageSize: number; hasPrevious: boolean; hasNext: boolean };
type Result<T> = { key: string; page?: ListPage<T>; legacy?: boolean; error?: string | ApiError };
const legacyPaths = { tasks: '/tasks', requests: '/purchase-requests', items: '/tasks/items/registry' } as const;
type Entity = keyof typeof legacyPaths;
export const viewKeys = ['view', 'status', 'overdue', 'delivery', 'priority', 'sort', 'direction', 'pageSize'] as const;
const queryKeys = ['q', ...viewKeys, 'page', 'supplier', 'payment', 'hasOrders', 'createdFrom', 'createdTo', 'deadlineFrom', 'deadlineTo'];

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
  const legacyEntity = useRef<Entity | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const legacyPath = legacyPaths[entity];
      const options = { signal, cache: 'no-store' } as const;
      const knownLegacy = legacyEntity.current === entity;
      let response = await apiFetch(knownLegacy ? legacyPath : `/discovery/lists/${entity}?${key}`, options);
      const legacy = knownLegacy || response.status === 404;
      if (legacy && !knownLegacy) {
        if (signal.aborted) return;
        legacyEntity.current = entity;
        response = await apiFetch(legacyPath, options);
      }
      if (!response.ok) throw await apiError(response, 'Не удалось загрузить список.');
      const data: T[] | ListPage<T> = await response.json();
      const page = Array.isArray(data)
        ? { items: data, total: data.length, page: 1, pageSize: data.length, hasPrevious: false, hasNext: false }
        : data;
      if (!signal.aborted) setResult({ key: requestKey, page, legacy });
    } catch (error) {
      if (!signal.aborted) setResult({ key: requestKey, error: apiProblem(error, 'Не удалось загрузить список.') });
    }
  }, [entity, key, requestKey]);
  useAbortableLoad(load);

  function change(next: URLSearchParams) {
    if (next.toString() !== new URLSearchParams(window.location.search).toString()) {
      window.history.pushState(null, '', next.size ? `${pathname}?${next}` : pathname);
    }
  }

  const current = result?.key === requestKey;
  return {
    page: result?.page,
    error: current ? result?.error : undefined,
    loading: !current,
    legacy: result?.legacy === true,
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
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? dateFormat.format(timestamp) : 'Не указано';
}

export function workingBack(value: string | null) {
  if (!value || !/^\/(?:\?|requests(?:\?|$)|registry(?:\?|$)|orders(?:\?|$)|analytics(?:\?|$)|suppliers\/[a-z\d-]+(?:\?|$)|$)/i.test(value)
    || /[\\\u0000-\u0020]/u.test(value)) return '/';
  return value;
}

export function workingLink(path: string, back: string) {
  const url = new URL(path, 'https://supply-manager.invalid');
  url.searchParams.set('back', back);
  return url.pathname + url.search + url.hash;
}
