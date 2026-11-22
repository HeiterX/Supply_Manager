import { ApiConnectionError } from './api-error';

const DEFAULT_API_URL = 'http://localhost:3000/api/v1';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || DEFAULT_API_URL
).replace(/\/+$/, '');

export const AUTH_EVENTS = {
  unauthorized: 'supply-manager:unauthorized',
} as const;

function isProtectedResource(path: string): boolean {
  return (
    path === '/tasks' ||
    path.startsWith('/tasks/') ||
    path.startsWith('/discovery/') ||
    path.startsWith('/next-actions/') ||
    path.startsWith('/notifications') ||
    path === '/purchase-requests' ||
    path.startsWith('/purchase-requests/public/items/') ||
    (path.startsWith('/purchase-requests/') &&
      !path.startsWith('/purchase-requests/public'))
  );
}

export async function apiFetch(
  path: `/${string}`,
  options: RequestInit = {},
): Promise<Response> {
  if (typeof window !== 'undefined' && !navigator.onLine) throw new ApiConnectionError('offline');
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, signal, credentials: 'include' });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiConnectionError(timeout.aborted ? 'timeout' : 'network');
  }

  if (response.status === 401 && typeof window !== 'undefined' && !signal.aborted && isProtectedResource(path.split('?')[0])) {
    window.dispatchEvent(new Event(AUTH_EVENTS.unauthorized));
  }

  return response;
}
