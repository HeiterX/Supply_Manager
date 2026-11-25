import { ApiConnectionError } from './api-error';

const DEFAULT_API_URL = 'http://localhost:3000/api/v1';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || DEFAULT_API_URL
).replace(/\/+$/, '');

export const AUTH_EVENTS = {
  unauthorized: 'supply-manager:unauthorized',
} as const;

const SAFE_METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

function isProtectedResource(path: string): boolean {
  return (
    path.startsWith('/telegram/') ||
    path.startsWith('/discovery/') ||
    path === '/suppliers' ||
    path.startsWith('/suppliers/') ||
    path === '/catalog' ||
    path.startsWith('/catalog/') ||
    path === '/tasks' ||
    path.startsWith('/tasks/') ||
    path.startsWith('/next-actions/') ||
    path.startsWith('/notifications') ||
    path === '/purchase-requests' ||
    path.startsWith('/purchase-requests/public/items/') ||
    (path.startsWith('/purchase-requests/') &&
      !path.startsWith('/purchase-requests/public'))
  );
}

function needsCsrfToken(
  path: string,
  options: RequestInit,
): boolean {
  const method = (options.method ?? 'GET').toUpperCase();

  if (SAFE_METHODS.has(method)) {
    return false;
  }

  if (
    path === '/auth/login' ||
    path === '/auth/register'
  ) {
    return false;
  }

  return true;
}

async function getCsrfToken(
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await fetch(
    `${API_BASE_URL}/auth/csrf`,
    {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal,
    },
  );

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      'Не удалось получить CSRF-токен',
    );
  }

  const data: unknown = await response.json();

  if (
    typeof data !== 'object' ||
    data === null ||
    !('csrfToken' in data) ||
    typeof data.csrfToken !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.csrfToken)
  ) {
    throw new Error(
      'Сервер вернул некорректный CSRF-токен',
    );
  }

  return data.csrfToken;
}

export async function apiFetch(
  path: `/${string}`,
  options: RequestInit = {},
): Promise<Response> {
  if (typeof window !== 'undefined' && !navigator.onLine) throw new ApiConnectionError('offline');
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const resourcePath = path.split('?')[0];
  const headers = new Headers(options.headers);
  let response: Response;
  try {
    if (needsCsrfToken(resourcePath, options)) {
      const csrfToken = await getCsrfToken(signal);
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
    }
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal, credentials: 'include' });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (!(error instanceof TypeError) && !timeout.aborted) throw error;
    throw new ApiConnectionError(timeout.aborted ? 'timeout' : 'network');
  }

  if (response.status === 401 && typeof window !== 'undefined' && !signal.aborted && isProtectedResource(resourcePath)) {
    window.dispatchEvent(new Event(AUTH_EVENTS.unauthorized));
  }

  return response;
}
