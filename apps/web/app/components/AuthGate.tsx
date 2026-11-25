'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AUTH_EVENTS } from '@/lib/api-client';
import { apiMessage, apiProblem, ApiError } from '@/lib/api-error';
import { getCurrentUser, signIn, signOut, type AuthUser } from '@/lib/auth';
import { useAbortableLoad } from '@/lib/use-abortable-load';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { useRetryDelay } from '@/lib/use-retry-delay';
import { Alert, Button, Card, Field, Input, Skeleton } from './ui';
import LoadError from './LoadError';

type Session = {
  user: AuthUser;
  signingOut: boolean;
  logoutError: string;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('AuthGate is required');
  return session;
}

export default function AuthGate({ children, allowEmployee = false }: { children: ReactNode; allowEmployee?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthUser | null>();
  const [connectionError, setConnectionError] = useState<string | ApiError>('');
  const [loginNotice, setLoginNotice] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const logoutLock = useRef(false);

  const checkSession = useCallback(async (signal: AbortSignal) => {
    setConnectionError('');
    try {
      const user = await getCurrentUser(signal);
      if (!signal.aborted) setSession(user);
    } catch (error) {
      if (!signal.aborted) setConnectionError(apiProblem(error, 'Не удалось проверить сессию.'));
    }
  }, []);
  const retry = useAbortableLoad(checkSession);

  useEffect(() => {
    function expire() {
      setLogoutError('');
      setLoginNotice('Сессия завершена. Войдите повторно.');
      setSession(null);
    }
    window.addEventListener(AUTH_EVENTS.unauthorized, expire);
    return () => window.removeEventListener(AUTH_EVENTS.unauthorized, expire);
  }, []);

  async function logout() {
    if (logoutLock.current) return;
    logoutLock.current = true;
    setSigningOut(true);
    setLogoutError('');
    try {
      await signOut();
      setSession(null);
      setLoginNotice('');
    } catch (error) {
      setLogoutError(apiMessage(error, 'Не удалось завершить сеанс.'));
    } finally {
      logoutLock.current = false;
      setSigningOut(false);
    }
  }

  if (session?.role === 'EMPLOYEE' && !allowEmployee) {
    return <main className="auth-screen">
      <Card className="auth-card">
        <h1>Недостаточно прав</h1>
        <Link href="/settings/telegram" className="text-sm font-medium text-accent hover:underline">Настройки Telegram</Link>
        {logoutError && <Alert tone="danger">{logoutError}</Alert>}
        <Button loading={signingOut} onClick={() => void logout()}>Выйти</Button>
      </Card>
    </main>;
  }

  if (session) return <SessionContext.Provider value={{ user: session, signingOut, logoutError, logout }}>{children}</SessionContext.Provider>;

  return <main className="auth-screen">
    {connectionError ? <Card className="auth-card">
      <h1>Ошибка подключения</h1>
      <LoadError message={connectionError} retry={() => void retry()} />
    </Card> : session === undefined ? <Skeleton label="Проверяем авторизацию" /> :
      <Login notice={loginNotice} onLogin={(user) => {
        if (user.role === 'EMPLOYEE' && pathname === '/') router.replace('/dashboard');
        setLoginNotice('');
        setSession(user);
      }} />}
  </main>;
}

function Login({ notice, onLogin }: { notice: string; onLogin: (user: AuthUser) => void }) {
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const waiting = useRetryDelay(failure?.retryAt);
  const lock = useRef(false);
  const username = useRef<HTMLInputElement>(null);
  const focus = useFocusAfterRender();

  useEffect(() => { if (notice) username.current?.focus(); }, [notice]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || waiting) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    lock.current = true;
    setBusy(true);
    setError('');
    setFailure(undefined);
    try {
      onLogin(await signIn(String(data.get('username')), String(data.get('password'))));
    } catch (error) {
      if (error instanceof ApiError) {
        setFailure(error);
        if (Object.keys(error.fields).length) focus(() => form.querySelector<HTMLElement>('[aria-invalid="true"]'));
        else if (error.status === 401) focus(() => username.current);
      }
      setError(apiMessage(error, 'Не удалось войти.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <Card className="auth-card">
    <span className="brand-mark" aria-hidden="true">SM</span>
    <h1>Вход в Supply Manager</h1>
    <p className="text-sm text-muted">Войдите под своей рабочей учётной записью.</p>
    {notice && <Alert>{notice}</Alert>}
    <form onSubmit={login} className="grid gap-4">
      <Field id="login-name" label="Логин" error={failure?.fields.username}>
        <Input ref={username} id="login-name" name="username" autoComplete="username" required />
      </Field>
      <Field id="login-password" label="Пароль" error={failure?.fields.password}>
        <Input id="login-password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" loading={busy} disabled={waiting}>{busy ? 'Входим…' : 'Войти'}</Button>
    </form>
    <Link href="/request" className="text-sm font-medium text-accent hover:underline">Подать заявку</Link>
    <Link href="/register" className="text-sm font-medium text-accent hover:underline">Создать учётную запись</Link>
  </Card>;
}
