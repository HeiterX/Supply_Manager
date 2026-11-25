'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate from '../../components/AuthGate';
import { apiFetch } from '../../../lib/api-client';

type Settings = {
  configured: boolean; connected: boolean; chatId: string | null; username: string | null; muted: boolean;
  pending: { id: string; expiresAt: string; chatId: string | null; username: string | null } | null;
  subscriptions: Array<{ category: string; enabled: boolean }>;
  deliveries: Array<{ status: string; errorCode: string | null; attempts: number; createdAt: string }>;
};
const labels: Record<string, string> = { NEW_REQUEST: 'Новые заявки', ASSIGNED_ACTION: 'Назначенные действия', PURCHASE_CHANGED: 'Изменения закупок', DUE_SOON: 'Приближение сроков', OVERDUE: 'Просрочки' };
const button = 'rounded-xl border border-slate-300 px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50';

async function call<T>(path: `/${string}`, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(path, { method, cache: 'no-store', signal, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(response.status === 401 ? 'Сессия завершена. Войдите повторно.' : response.status === 409 ? 'Аккаунт уже подключён. Обновите состояние или отключите Telegram.' : response.status === 400 ? 'Подтверждение истекло. Создайте новую ссылку.' : response.status === 503 ? 'Telegram пока не настроен администратором.' : 'Не удалось выполнить запрос. Повторите попытку.');
  return response.json() as Promise<T>;
}

function TelegramSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const running = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void call<Settings>('/telegram/settings', 'GET', undefined, controller.signal).then(value => { if (active.current) setSettings(value); }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Ошибка подключения'); });
    return () => { active.current = false; controller.abort(); };
  }, []);

  async function perform(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { if (active.current) { setError(e instanceof Error ? e.message : 'Ошибка подключения'); setSettings(null); } }
    finally { running.current = false; if (active.current) setBusy(false); }
  }
  async function refresh() {
    const next = await call<Settings>('/telegram/settings');
    if (active.current) setSettings(next);
  }
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/" className="text-sm text-blue-700 underline">Supply Manager</Link>
      <header><p className="text-sm text-slate-500">Настройки интеграций</p><h1 className="mt-1 text-3xl font-semibold">Telegram</h1><p className="mt-3 text-slate-600">Уведомления и быстрый доступ к доступным вам данным.</p></header>
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{notice}</p> : null}
      {!settings ? <section className="rounded-2xl border bg-white p-6"><p>{error ? 'Состояние подключения неизвестно.' : 'Загружаем настройки…'}</p><button className={`${button} mt-4`} disabled={busy} onClick={() => void perform(refresh)}>Обновить состояние</button></section> : <>
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">{settings.connected ? 'Telegram подключён' : 'Telegram не подключён'}</h2>
          {settings.connected ? <p className="break-words">{settings.username ? `@${settings.username} · ` : ''}ID {settings.chatId}</p> : <p className="text-sm text-slate-600">Создайте ссылку, откройте бота, затем вернитесь сюда и подтвердите аккаунт. Ссылка действует 5 минут. Пароль в Telegram вводить не нужно.</p>}
          {!settings.configured ? <p className="text-sm text-amber-800">Бот пока не настроен администратором.</p> : null}
          {settings.muted ? <p className="text-sm text-amber-800">Telegram отклонил доставку. Разблокируйте бота, отключите интеграцию и подключите её заново.</p> : null}
          {!settings.connected ? <button disabled={busy || !settings.configured} className={`${button} bg-blue-600 text-white`} onClick={() => void perform(async () => { const value = await call<{ url: string; expiresAt: string }>('/telegram/link', 'POST'); if (active.current) setLink(value); await refresh(); })}>Подключить Telegram</button> : <button disabled={busy} className={button} onClick={() => setConfirmUnlink(true)}>Отключить Telegram</button>}
          {link && !settings.connected ? <p><a href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="font-medium text-blue-700 underline">Открыть бота в Telegram</a><span className="mt-1 block text-sm text-slate-500">До {new Date(link.expiresAt).toLocaleTimeString('ru-RU')}</span></p> : null}
          {settings.pending?.chatId ? <div className="space-y-3 rounded-xl bg-blue-50 p-4"><p className="break-words">Подтвердите свой аккаунт: {settings.pending.username ? `@${settings.pending.username} · ` : ''}ID {settings.pending.chatId}</p><p className="text-sm">Если это не ваш аккаунт, отмените подключение.</p><button disabled={busy} className={button} onClick={() => void perform(async () => { const value = await call<Settings>(`/telegram/link/${settings.pending!.id}/confirm`, 'POST'); if (active.current) { setSettings(value); setLink(null); setNotice('Telegram подключён.'); } })}>Это мой аккаунт — подтвердить</button></div> : null}
          {settings.pending ? <button disabled={busy} className={button} onClick={() => void perform(async () => { const value = await call<Settings>('/telegram/link', 'DELETE'); if (active.current) { setSettings(value); setLink(null); } })}>Отменить подключение</button> : null}
          <button disabled={busy} className={button} onClick={() => void perform(refresh)}>Обновить состояние</button>
          {confirmUnlink ? <div role="group" aria-label="Подтверждение отключения" className="space-y-3 rounded-xl border border-red-200 p-4"><p>Отключить Telegram и отменить ожидающие уведомления?</p><div className="flex flex-wrap gap-3"><button disabled={busy} className={`${button} text-red-700`} onClick={() => void perform(async () => { const value = await call<Settings>('/telegram/link', 'DELETE'); if (active.current) { setSettings(value); setLink(null); setConfirmUnlink(false); setNotice('Telegram отключён.'); } })}>Да, отключить</button><button disabled={busy} className={button} onClick={() => setConfirmUnlink(false)}>Отмена</button></div></div> : null}
        </section>
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">Подписки</h2><p className="text-sm text-slate-600">Назначения и напоминания будут доступны после запуска сервиса напоминаний.</p>
          {settings.subscriptions.length ? settings.subscriptions.map(s => <label key={s.category} className="flex items-center gap-3"><input type="checkbox" checked={s.enabled} disabled={busy} onChange={e => { const enabled = e.target.checked; void perform(async () => { const value = await call<Settings>('/telegram/subscriptions', 'PATCH', { category: s.category, enabled }); if (active.current) setSettings(value); }); }} className="h-5 w-5 accent-blue-600" />{labels[s.category] ?? s.category}</label>) : <p className="text-sm text-slate-600">Для вашей роли закупочные уведомления недоступны. В боте можно просматривать свои заявки.</p>}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">Последние доставки</h2>{settings.deliveries.length ? <ul className="mt-4 space-y-2 text-sm">{settings.deliveries.map((d, i) => <li key={`${d.createdAt}-${i}`} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2"><time>{new Date(d.createdAt).toLocaleString('ru-RU')}</time><span>{d.status}{d.errorCode ? ` · ${d.errorCode}` : ''} · попыток {d.attempts}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">Доставок пока нет.</p>}</section>
      </>}
    </div>
  </main>;
}

export default function Page() { return <AuthGate allowEmployee><TelegramSettings /></AuthGate>; }
