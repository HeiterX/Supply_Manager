'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AUTH_EVENTS } from '@/lib/api-client';
import { getCurrentUser, signIn, signOut, type AuthUser } from '@/lib/auth';
import { useAbortableLoad } from '@/lib/use-abortable-load';
import { Alert, Button, Card, Field, Input, Skeleton } from './ui';

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
  const [connectionError, setConnectionError] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  const checkSession = useCallback(async (signal: AbortSignal) => {
    setConnectionError('');
    try {
      const user = await getCurrentUser(signal);
      if (!signal.aborted) setSession(user);
    } catch (error) {
      if (!signal.aborted) setConnectionError(error instanceof Error ? error.message : 'Не удалось проверить сессию.');
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
    setSigningOut(true);
    setLogoutError('');
    try {
      await signOut();
      setSession(null);
      setLoginNotice('');
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Не удалось завершить сеанс.');
    } finally {
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
      <Alert tone="danger">{connectionError}</Alert>
      <Button onClick={() => void retry()}>Повторить</Button>
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
  const [busy, setBusy] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      onLogin(await signIn(String(data.get('username')), String(data.get('password'))));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось войти.');
    } finally {
      setBusy(false);
    }
  }

  return <Card className="auth-card">
    <span className="brand-mark" aria-hidden="true">SM</span>
    <h1>Вход в Supply Manager</h1>
    <p className="text-sm text-muted">Войдите под своей рабочей учётной записью.</p>
    {notice && <Alert>{notice}</Alert>}
    <form onSubmit={login} className="grid gap-4">
      <Field id="login-name" label="Логин">
        <Input id="login-name" name="username" autoComplete="username" required />
      </Field>
      <Field id="login-password" label="Пароль">
        <Input id="login-password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" loading={busy}>{busy ? 'Входим…' : 'Войти'}</Button>
    </form>
    <Link href="/request" className="text-sm font-medium text-accent hover:underline">Подать заявку</Link>
  </Card>;
}
