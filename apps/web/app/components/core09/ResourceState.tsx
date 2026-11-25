'use client';
export const controlClass = 'rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50';
export function Skeleton() {
  return <div role="status" aria-label="Загрузка" className="space-y-4"><span className="sr-only">Загружаем данные…</span>{[0, 1, 2].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none" />)}</div>;
}
export function ResourceError({ error, retry }: { error?: string; retry: () => void }) {
  return <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900"><p>{error ?? 'Не удалось загрузить данные.'}</p><button onClick={retry} className={`${controlClass} mt-3`}>Повторить</button></div>;
}
export function NotConnected({ children }: { children?: React.ReactNode }) {
  return <div role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950"><p className="font-semibold">Ожидаем подключение сервиса</p><p>{children ?? 'Уведомления появятся после подключения серверного сервиса. Сейчас список и счётчик недоступны.'}</p></div>;
}
