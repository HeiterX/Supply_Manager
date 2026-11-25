'use client';

import { AUTH_EVENTS } from '../../lib/api-client';
import Link from 'next/link';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import {
  getCurrentUser,
  signIn,
  signOut,
  type AuthUser,
} from '../../lib/auth';

type AuthStatus =
  | 'checking'
  | 'guest'
  | 'authorized'
  | 'forbidden'
  | 'error';

type AuthGateProps = {
  children: ReactNode;
  allowEmployee?: boolean;
};

const CurrentUserContext = createContext<AuthUser | null>(null);

export function useCurrentUser() {
  return useContext(CurrentUserContext);
}

function hasProcurementAccess(user: AuthUser): boolean {
  return user.role === 'PROCUREMENT' || user.role === 'ADMIN';
}

export default function AuthGate({ children, allowEmployee = false }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [user, setUser] = useState<AuthUser | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    getCurrentUser()
      .then((currentUser) => {
        if (!active) return;

        setUser(currentUser);

        if (!currentUser) {
          setStatus('guest');
        } else if (allowEmployee || hasProcurementAccess(currentUser)) {
          setStatus('authorized');
        } else {
          setStatus('forbidden');
        }
      })
      .catch((err: unknown) => {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : 'Не удалось проверить сессию',
        );

        setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [allowEmployee]);

  
  useEffect(() => {
    function handleUnauthorized() {
      setUser(null);
      setPassword('');
      setError('Сессия завершена. Войдите повторно.');
      setStatus('guest');
    }

    function handleForbidden() {
      setError('Сервер отказал в доступе к закупкам.');
      setStatus('forbidden');
    }

    window.addEventListener(
      AUTH_EVENTS.unauthorized,
      handleUnauthorized,
    );

    window.addEventListener(
      AUTH_EVENTS.forbidden,
      handleForbidden,
    );

    return () => {
      window.removeEventListener(
        AUTH_EVENTS.unauthorized,
        handleUnauthorized,
      );

      window.removeEventListener(
        AUTH_EVENTS.forbidden,
        handleForbidden,
      );
    };
  }, []);


  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError('');

    try {
      const currentUser = await signIn(username, password);

      setUser(currentUser);
      setPassword('');

      setStatus(
        (allowEmployee || hasProcurementAccess(currentUser))
          ? 'authorized'
          : 'forbidden',
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Ошибка авторизации',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setError('');

    try {
      await signOut();

      setUser(null);
      setPassword('');
      setStatus('guest');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось завершить сессию',
      );
    } finally {
      setBusy(false);
    }
  }

  if (status === 'checking') {
    return (
      <div className="p-8 text-center text-slate-500">
        Проверяем авторизацию...
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border p-6">
        <h2 className="text-xl font-semibold">
          Ошибка подключения
        </h2>

        <p className="mt-3 text-sm text-red-600">{error}</p>

        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (status === 'guest') {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">
          Вход в Supply Manager
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          {allowEmployee ? 'Войдите в свою учётную запись Supply Manager.' : 'Войдите под учётной записью сотрудника снабжения.'}
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <label className="block text-sm">
            Логин
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="mt-1 w-full rounded-lg border p-3"
            />
          </label>

          <label className="block text-sm">
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-lg border p-3"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-blue-600 p-3 text-white disabled:opacity-50"
          >
            {busy ? 'Входим...' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  if (status === 'forbidden') {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">
          Недостаточно прав
        </h2>

        <p className="mt-3 text-sm text-slate-600">
          Ваша роль: {user?.role}.
          Доступ к закупкам разрешён только PROCUREMENT и ADMIN.
        </p>
        <Link href="/settings/telegram" className="mt-4 block text-blue-700 underline">Настройки Telegram</Link>

        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}

        <button
          onClick={handleLogout}
          disabled={busy}
          className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-white"
        >
          Выйти
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-4 px-6 py-3 text-sm">
        <span>{user?.fullName}</span>
        <Link href="/settings/telegram" className="rounded-lg border px-3 py-2">Telegram</Link>

        <button
          onClick={handleLogout}
          disabled={busy}
          className="rounded-lg border px-3 py-2"
        >
          Выйти
        </button>

        {error && (
          <span className="text-red-600">{error}</span>
        )}
      </div>

      <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
    </>
  );
}
