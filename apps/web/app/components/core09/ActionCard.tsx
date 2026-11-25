import Link from 'next/link';
import { formatActionDate, type NextAction } from '../../../lib/core09-api';

const statuses = {
  OVERDUE: ['! Просрочено', 'border-rose-200 bg-rose-50 text-rose-800'],
  TODAY: ['◷ Сегодня', 'border-amber-200 bg-amber-50 text-amber-900'],
  PLANNED: ['◷ Запланировано', 'border-blue-200 bg-blue-50 text-blue-800'],
  WAITING_SUPPLIER: ['↗ Ожидаем поставщика', 'border-violet-200 bg-violet-50 text-violet-800'],
  COMPLETED: ['✓ Выполнено', 'border-emerald-200 bg-emerald-50 text-emerald-800'],
  CANCELLED: ['Отменено', 'border-slate-200 bg-slate-50 text-slate-600'],
};
export function ActionBadge({ status }: { status: NextAction['status'] }) {
  const [label, tone] = statuses[status] ?? ['Статус не предоставлен', 'border-slate-200 bg-slate-50 text-slate-600'];
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}
export function ActionCard({ action, timeZone, linked = true }: { action: NextAction; timeZone?: string; linked?: boolean }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><ActionBadge status={action.status} /><span className="text-xs text-slate-500">Закупка №{action.task.number}</span></div>
    <h2 className="mt-4 break-words text-lg font-semibold text-slate-950">{action.title}</h2>
    <p className="mt-1 break-words text-sm text-slate-500">{action.task.title}</p>
    <dl className="my-5 grid gap-4 text-sm sm:grid-cols-2">
      <div><dt className="text-slate-500">Ответственный</dt><dd className="mt-1 font-medium text-slate-900">{action.assignee?.fullName ?? 'Не назначен'}</dd></div>
      <div><dt className="text-slate-500">Выполнить до</dt><dd className="mt-1 font-medium text-slate-900">{formatActionDate(action.dueAt, timeZone)}</dd></div>
      {action.reminderAt && <div><dt className="text-slate-500">Напоминание</dt><dd className="mt-1 text-slate-900">{formatActionDate(action.reminderAt, timeZone)}</dd></div>}
      {action.priority && <div><dt className="text-slate-500">Приоритет</dt><dd className="mt-1 text-slate-900">{{ LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', URGENT: 'Срочный' }[action.priority] ?? action.priority}</dd></div>}
    </dl>
    {linked && <Link href={`/tasks/${encodeURIComponent(action.task.id)}`} className="inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Перейти к закупке →</Link>}
  </article>;
}
