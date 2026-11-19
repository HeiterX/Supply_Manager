
import { apiFetch } from './api-client';

export type UserRole = 'EMPLOYEE' | 'PROCUREMENT' | 'ADMIN';

export type AuthUser = {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
};

type ApiErrorResponse = {
  message?: string | string[];
};

async function getErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | ApiErrorResponse
    | null;

  if (Array.isArray(data?.message)) {
    return data.message.join('; ');
  }

  if (typeof data?.message === 'string') {
    return data.message;
  }

  return fallback;
}

/**
 * Проверяет существующую cookie-сессию.
 *
 * 200 -> возвращает пользователя.
 * 401 -> возвращает null.
 * Другие ошибки -> выбрасывает исключение.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await apiFetch('/auth/me', {
    cache: 'no-store',
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Не удалось проверить авторизацию',
      ),
    );
  }

  return (await response.json()) as AuthUser;
}

/**
 * Выполняет вход через существующий NestJS API.
 * Сервер самостоятельно устанавливает HttpOnly cookie.
 */
export async function signIn(
  username: string,
  password: string,
): Promise<AuthUser> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Не удалось войти в систему'),
    );
  }

  const data = (await response.json()) as {
    user: AuthUser;
  };

  return data.user;
}

/**
 * Завершает сессию.
 * Сервер удаляет cookie, frontend затем очищает состояние.
 */
export async function signOut(): Promise<void> {
  const response = await apiFetch('/auth/logout', {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Не удалось завершить сеанс');
  }
}
