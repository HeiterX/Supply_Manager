'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { apiFetch } from './api-client';
import { useAbortableLoad } from './use-abortable-load';

export type Entity = 'tasks' | 'items' | 'suppliers' | 'orders' | 'requests';
export type Format = 'csv' | 'xlsx';
export type Page<T> = {
  items: T[]; total: number; page: number; pageSize: number;
  hasPrevious: boolean; hasNext: boolean;
};
type Resource<T> = { path: string; data: T | null; error: string };

export const entityLabels: Record<Entity, string> = {
  tasks: 'Закупка', items: 'Позиция', suppliers: 'Поставщик', orders: 'Заказ', requests: 'Заявка',
};

export const statusLabels: Record<string, string> = {
  NEW: 'Новая', SEARCHING: 'Поиск поставщика', NEGOTIATION: 'Переговоры', ORDERED: 'Заказано',
  WAITING_PAYMENT: 'Ожидает оплаты', WAITING_SHIPMENT: 'Ожидает отгрузки', IN_TRANSIT: 'В пути',
  READY_FOR_PICKUP: 'Готово к получению', RECEIVED: 'Получено', HANDED_OVER: 'Передано',
  CLOSED: 'Закрыто', CANCELLED: 'Отменено', IN_REVIEW: 'В работе',
  NEEDS_CLARIFICATION: 'Требует уточнения', APPROVED: 'Принята', REJECTED: 'Отклонена',
  CONVERTED: 'Передана в закупку',
};
export const priorityLabels = { LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', URGENT: 'Срочный' };
export const reportTimeZone = 'Europe/Moscow';
export const formatReportDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: reportTimeZone }).format(new Date(value))
  : '—';

export async function responseError(response: Response) {
  const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
  return Array.isArray(body?.message) ? body.message.join('. ')
    : body?.message ?? `Ошибка сервера (${response.status})`;
}

export function useCoreResource<T>(path: `/${string}` | null, delay = 0) {
  const [result, setResult] = useState<Resource<T> | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!path) return;
    try {
      if (delay) {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, delay);
          signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      if (signal.aborted) return;
      const response = await apiFetch(path, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as T;
      if (!signal.aborted) setResult({ path, data, error: '' });
    } catch (error) {
      if (!signal.aborted) {
        setResult({ path, data: null, error: error instanceof TypeError
          ? 'Сервер недоступен. Проверьте подключение и повторите попытку.'
          : error instanceof Error ? error.message : 'Не удалось загрузить данные.' });
      }
    }
  }, [path, delay]);
  const run = useAbortableLoad(load);
  const current = path && result?.path === path ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? '',
    loading: Boolean(path && !current),
    reload: () => {
      setResult(null);
      return run();
    },
  };
}

export function useDiscoveryList<T>(entity: Entity, fixed?: Record<string, string>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = new URLSearchParams(searchParams);
  for (const [key, value] of Object.entries(fixed ?? {})) query.set(key, value);
  const endpoint = `/discovery/lists/${entity}` as const;
  const resource = useCoreResource<Page<T>>(`${endpoint}?${query}`);
  const exportQuery = new URLSearchParams(query);
  exportQuery.delete('page');
  exportQuery.delete('pageSize');
  const change = (next: URLSearchParams) => {
    if (next.toString() !== searchParams.toString()) {
      window.history.pushState(null, '', next.size ? `${pathname}?${next}` : pathname);
    }
  };
  return {
    ...resource, query, change,
    exportUrl: `${endpoint}/export?${exportQuery}` as const,
    setPage: (page: number) => {
      const next = new URLSearchParams(searchParams);
      if (page === 1) next.delete('page');
      else next.set('page', String(page));
      change(next);
    },
  };
}

export async function downloadReport(url: `/${string}`, format: Format, name: string) {
  const response = await apiFetch(`${url}${url.endsWith('?') ? '' : '&'}format=${format}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  const timestamp = new Intl.DateTimeFormat('sv-SE', { timeZone: reportTimeZone, dateStyle: 'short' }).format(new Date());
  link.href = objectUrl;
  link.download = `supply-manager-${name}-${timestamp}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}


export function formatDecimal(value: string | null, currency?: string) {
  if (value === null) return '—';
  const [whole, fraction] = value.split('.');
  const sign = whole.startsWith('-') ? '−' : '';
  const amount = new Intl.NumberFormat('ru-RU').format(BigInt(whole.replace('-', '')));
  return `${sign}${amount}${fraction ? `,${fraction}` : ''}${currency ? ` ${currency}` : ''}`;
}

export function taskLink(id: string, path: string, query: URLSearchParams, tab?: 'order' | 'items', target?: string) {
  const back = query.size ? `${path}?${query}` : path;
  const params = new URLSearchParams({ back });
  if (tab) params.set('tab', tab);
  return `/tasks/${id}?${params}${target ? `#${tab}-${target}` : ''}`;
}

export function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  const url = new URL(value, 'https://supply-manager.invalid');
  if (url.origin !== 'https://supply-manager.invalid') return '/';
  const path = url.pathname;
  return ['/', '/registry', '/orders', '/analytics'].includes(path) || /^\/suppliers\/[a-z0-9-]+$/i.test(path)
    ? `${path}${url.search}`
    : '/';
}
