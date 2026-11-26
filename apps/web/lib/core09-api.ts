import { apiFetch } from './api-client';

// Proposed contract; until Maxim supplies it, 404 is an explicit unavailable state.
export type ActionStatus = 'OVERDUE' | 'TODAY' | 'PLANNED' | 'WAITING_SUPPLIER' | 'COMPLETED' | 'CANCELLED';
export type ActionScope = 'mine' | 'all' | 'unassigned';
export type ActionFilter = 'all' | 'today' | 'overdue' | 'waiting_supplier';
export type NextAction = {
  id: string; version: number; title: string;
  task: { id: string; number: number; title: string };
  assignee: { id: string; fullName: string } | null;
  dueAt: string | null; reminderAt: string | null; status: ActionStatus;
  priority?: string; allowedOperations: ('UPDATE' | 'COMPLETE')[];
};
export type ActionHistory = {
  id: string; type: string; createdAt: string;
  actor: { fullName: string } | null; comment: string | null;
};
export type ActionPage = {
  items: NextAction[]; total: number; page: number; pageSize: number;
  counts: Record<ActionFilter, number>; timeZone: string;
};
export type Notice = {
  id: string; type: string; title: string; message: string | null;
  task: { id: string; number: number; title: string };
  createdAt: string; readAt: string | null;
};
export type NoticePage = { items: Notice[]; unreadCount: number; total: number; page: number; pageSize: number };

export class Core09Error extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function errorMessage(error: unknown): string {
  if (error instanceof Core09Error) return error.message;
  return 'Сервер недоступен. Проверьте подключение и повторите попытку.';
}
export async function core09Request<T>(path: string, signal: AbortSignal, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path as `/${string}`, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: 'no-store' });
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: 'Сессия завершена. Войдите повторно.', 403: 'Нет доступа к этим данным.',
      404: 'Этот раздел ещё не подключён к серверу.',
      409: 'Данные изменились. Обновите действие и повторите операцию.',
      400: 'Проверьте название и даты действия.', 422: 'Проверьте название и даты действия.',
    };
    // Server error bodies can contain internal details; show safe status messages.
    throw new Core09Error(response.status, messages[response.status] ?? 'Не удалось получить данные. Повторите попытку.');
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
export function loadActions(filter: ActionFilter, query: string, page: number, signal: AbortSignal, scope: ActionScope = 'mine') {
  const params = new URLSearchParams({ scope, filter, q: query, page: String(page), limit: '20', sort: 'dueAt' });
  return core09Request<ActionPage>(`/next-actions?${params}`, signal);
}
export function loadNotices(filter: string, page: number, signal: AbortSignal) {
  return core09Request<NoticePage>(`/notifications?filter=${filter}&page=${page}&limit=20`, signal);
}
export const uniqueById = <T extends { id: string }>(items: T[]): T[] => [...new Map(items.map(item => [item.id, item])).values()];
export function pageFromQuery(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
export function formatActionDate(value: string | null, timeZone?: string): string {
  if (!value) return 'Не задан';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Дата недоступна';
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone, timeZoneName: undefined }).format(date);
  } catch { return 'Дата недоступна'; }
}
export function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
