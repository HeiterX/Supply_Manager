
import { apiFetch } from './api-client';
import { apiError, ApiError } from './api-error';

export type UserRole = 'EMPLOYEE' | 'PROCUREMENT' | 'ADMIN';

export type AuthUser = {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
};

/**
 * Проверяет существующую cookie-сессию.
 *
 * 200 -> возвращает пользователя.
 * 401 -> возвращает null.
 * Другие ошибки -> выбрасывает исключение.
 */
export async function getCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  const response = await apiFetch('/auth/me', {
    cache: 'no-store',
    signal,
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw await apiError(response, 'Не удалось проверить авторизацию.');
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
    if (response.status === 401) throw new ApiError('Проверьте логин и пароль.', 401);
    if (response.status === 403) throw new ApiError('Учётная запись недоступна. Обратитесь к администратору.', 403);
    throw await apiError(response, 'Не удалось войти в систему.', { username: 'Логин', password: 'Пароль' });
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
    throw await apiError(response, 'Не удалось завершить сеанс.');
  }
}
