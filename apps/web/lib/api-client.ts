const DEFAULT_API_URL = 'http://localhost:3000/api/v1';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || DEFAULT_API_URL
).replace(/\/+$/, '');

export const AUTH_EVENTS = {
  unauthorized: 'supply-manager:unauthorized',
  forbidden: 'supply-manager:forbidden',
} as const;

const SAFE_METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

function isProtectedResource(path: string): boolean {
  return (
    path.startsWith('/telegram/') ||
    path === '/tasks' ||
    path.startsWith('/tasks/') ||
    path === '/purchase-requests' ||
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
  const page = typeof window === 'undefined' ? null : window.location.pathname;
  const resourcePath = path.split('?')[0];
  const headers = new Headers(options.headers);

  if (needsCsrfToken(resourcePath, options)) {
    const csrfToken = await getCsrfToken(
      options.signal ?? undefined,
    );

    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  const response = await fetch(
    `${API_BASE_URL}${path}`,
    {
      ...options,
      headers,
      credentials: 'include',
    },
  );

  if (
    typeof window !== 'undefined' &&
    !options.signal?.aborted &&
    isProtectedResource(resourcePath)
  ) {
    if (response.status === 401) {
      window.dispatchEvent(
        new Event(AUTH_EVENTS.unauthorized),
      );
    }

    if (response.status === 403 && window.location.pathname === page) {
      window.dispatchEvent(
        new Event(AUTH_EVENTS.forbidden),
      );
    }
  }

  return response;
}
