
const DEFAULT_API_URL = 'http://localhost:3000/api/v1';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || DEFAULT_API_URL
).replace(/\/+$/, '');

export const AUTH_EVENTS = {
  unauthorized: 'supply-manager:unauthorized',
  forbidden: 'supply-manager:forbidden',
} as const;

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

export async function apiFetch(
  path: `/${string}`,
  options: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
  });

  if (typeof window !== 'undefined' && isProtectedResource(path)) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_EVENTS.unauthorized));
    }

    if (response.status === 403) {
      window.dispatchEvent(new Event(AUTH_EVENTS.forbidden));
    }
  }

  return response;
}
