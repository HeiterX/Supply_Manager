'use client';
import AuthGate from './components/AuthGate';
import { apiFetch } from '../lib/api-client';
import Link from 'next/link';
import { Suspense, useState, type FormEvent } from 'react';
import { reportTimeZone, taskLink, useCoreResource, useDiscoveryList } from '../lib/discovery';
import { DiscoveryControls, Pagination } from './components/DiscoveryControls';
import AppShell from './components/AppShell';

type Task = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  nextAction: string | null;
  reminderAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  _count: { items: number };
};

type AttentionReason = {
  label: string;
  tone: 'rose' | 'amber' | 'blue' | 'violet';
  score: number;
};


const terminalStatuses = new Set(['CLOSED', 'CANCELLED']);

const statusLabels: Record<string, string> = {
  NEW: 'Новая',
  SEARCHING: 'Поиск поставщика',
  NEGOTIATION: 'Переговоры',
  ORDERED: 'Заказано',
  WAITING_PAYMENT: 'Ожидает оплаты',
  WAITING_SHIPMENT: 'Ожидает отгрузки',
  IN_TRANSIT: 'В пути',
  READY_FOR_PICKUP: 'Готово к получению',
  RECEIVED: 'Получено',
  HANDED_OVER: 'Передано',
  CLOSED: 'Закрыто',
  CANCELLED: 'Отменено',
};

const priorityLabels: Record<string, string> = {
  LOW: 'Низкий',
  NORMAL: 'Обычный',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};

const statusTone: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  SEARCHING: 'bg-violet-50 text-violet-700',
  NEGOTIATION: 'bg-fuchsia-50 text-fuchsia-700',
  ORDERED: 'bg-indigo-50 text-indigo-700',
  WAITING_PAYMENT: 'bg-amber-50 text-amber-700',
  WAITING_SHIPMENT: 'bg-orange-50 text-orange-700',
  IN_TRANSIT: 'bg-blue-50 text-blue-700',
  READY_FOR_PICKUP: 'bg-cyan-50 text-cyan-700',
  RECEIVED: 'bg-emerald-50 text-emerald-700',
  HANDED_OVER: 'bg-teal-50 text-teal-700',
  CLOSED: 'bg-slate-100 text-slate-500',
  CANCELLED: 'bg-rose-50 text-rose-700',
};

const attentionTone: Record<AttentionReason['tone'], string> = {
  rose: 'bg-rose-50 text-rose-700 ring-rose-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
};

function formatDate(value: string | null) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: reportTimeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: reportTimeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function isActive(task: Task) {
  return !terminalStatuses.has(task.status);
}

function isOverdue(task: Task) {
  return (
    isActive(task) &&
    Boolean(task.deadline) &&
    new Date(task.deadline as string).getTime() < Date.now()
  );
}

function isReminderDue(task: Task) {
  return (
    isActive(task) &&
    Boolean(task.reminderAt) &&
    new Date(task.reminderAt as string).getTime() <= Date.now()
  );
}

function getAttentionReason(task: Task): AttentionReason | null {
  if (!isActive(task)) return null;

  if (isOverdue(task)) {
    return {
      label: 'Просрочен срок',
      tone: 'rose',
      score: 100,
    };
  }

  if (isReminderDue(task)) {
    return {
      label: 'Напоминание наступило',
      tone: 'amber',
      score: 90,
    };
  }

  if (task.priority === 'URGENT') {
    return {
      label: 'Срочный приоритет',
      tone: 'rose',
      score: 80,
    };
  }

  if (task.status === 'READY_FOR_PICKUP') {
    return {
      label: 'Груз готов к получению',
      tone: 'blue',
      score: 75,
    };
  }

  if (task.status === 'RECEIVED') {
    return {
      label: 'Нужно передать товар',
      tone: 'blue',
      score: 70,
    };
  }

  if (task.status === 'HANDED_OVER') {
    return {
      label: 'Можно закрыть закупку',
      tone: 'violet',
      score: 65,
    };
  }

  if (task.priority === 'HIGH') {
    return {
      label: 'Высокий приоритет',
      tone: 'amber',
      score: 55,
    };
  }

  return null;
}

function deadlineLabel(task: Task) {
  if (!task.deadline) {
    return {
      text: 'Без срока',
      className: 'text-slate-400',
    };
  }

  if (isOverdue(task)) {
    return {
      text: `Просрочено · ${formatDate(task.deadline)}`,
      className: 'font-semibold text-rose-600',
    };
  }

  if (formatDate(task.deadline) === formatDate(new Date().toISOString())) {
    return {
      text: `Сегодня · ${formatDate(task.deadline)}`,
      className: 'font-semibold text-amber-600',
    };
  }

  return {
    text: formatDate(task.deadline),
    className: 'text-slate-600',
  };
}

function StatIcon({
  type,
}: {
  type: 'active' | 'attention' | 'overdue' | 'transit';
}) {
  const common = 'h-5 w-5';

  if (type === 'active') {
    return (
      <svg
        className={common}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </svg>
    );
  }

  if (type === 'attention') {
    return (
      <svg
        className={common}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M12 3 2.8 19h18.4L12 3Z" />
        <path d="M12 9v4M12 16.5v.5" />
      </svg>
    );
  }

  if (type === 'overdue') {
    return (
      <svg
        className={common}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  return (
    <svg
      className={common}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

function HomeContent() {
  const list = useDiscoveryList<Task>('tasks');
  const { data, loading, error: loadError } = list;
  const filteredTasks = data?.items ?? [];
  const overview = useCoreResource<{
    active: number; attention: number; overdue: number; inTransit: number; attentionTasks: Task[];
  }>('/discovery/task-overview');
  const counts = overview.data;
  const attentionTasks = (counts?.attentionTasks ?? []).flatMap((task) => {
    const reason = getAttentionReason(task);
    return reason ? [{ task, reason }] : [];
  });

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [deadline, setDeadline] = useState('');

  function loadData() {
    return Promise.all([list.reload(), overview.reload()]);
  }

  function quickFilter(params: Record<string, string>) {
    list.change(new URLSearchParams(params));
  }

  function resetCreateForm() {
    setTitle('');
    setDescription('');
    setPriority('NORMAL');
    setDeadline('');
    setCreateError('');
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim()) {
      setCreateError('Введите название закупки.');
      return;
    }

    setIsCreating(true);
    setCreateError('');

    try {
      const response = await apiFetch('/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          deadline: deadline
            ? new Date(deadline).toISOString()
            : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      resetCreateForm();
      setIsCreateOpen(false);
      await loadData();
    } catch (error) {
      console.error(error);
      setCreateError('Не удалось создать закупку.');
    } finally {
      setIsCreating(false);
    }
  }

  const newButton = (
    <button
      onClick={() => {
        resetCreateForm();
        setIsCreateOpen(true);
      }}
      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition hover:bg-blue-700"
    >
      <span className="text-lg leading-none">＋</span>
      <span className="hidden sm:inline">Новая закупка</span>
      <span className="sm:hidden">Новая</span>
    </button>
  );

  return (
    <AppShell
      title="Закупки"
      subtitle="Контроль сроков, следующих действий и движения закупок"
      action={newButton}
    >
      {(loadError || overview.error) && (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{loadError || overview.error}</span>
          <button
            type="button"
            onClick={() => void loadData()}
            className="self-start rounded-lg bg-white px-3 py-2 text-xs font-semibold text-rose-700 shadow-sm ring-1 ring-rose-200 sm:self-auto"
          >
            Повторить
          </button>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => quickFilter({ view: 'active' })}
          className="group rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <StatIcon type="active" />
            </div>
            <span className="text-xs font-medium text-slate-400">В работе</span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-slate-950">
            {counts?.active ?? '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            активных закупок
          </div>
        </button>

        <button
          type="button"
          onClick={() => quickFilter({ view: 'attention' })}
          className="group rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-left shadow-sm transition hover:border-amber-200 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-amber-600 shadow-sm">
              <StatIcon type="attention" />
            </div>
            <span className="text-xs font-medium text-amber-600">
              Внимание
            </span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-amber-800">
            {counts?.attention ?? '—'}
          </div>
          <div className="mt-1 text-xs text-amber-700/70">
            требуют действия
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            quickFilter({ overdue: 'true' });
          }}
          className="group rounded-2xl border border-rose-100 bg-rose-50/60 p-4 text-left shadow-sm transition hover:border-rose-200 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-rose-600 shadow-sm">
              <StatIcon type="overdue" />
            </div>
            <span className="text-xs font-medium text-rose-600">
              Сроки
            </span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-rose-800">
            {counts?.overdue ?? '—'}
          </div>
          <div className="mt-1 text-xs text-rose-700/70">
            просрочено
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            quickFilter({ view: 'logistics' });
          }}
          className="group rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 text-left shadow-sm transition hover:border-cyan-200 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-cyan-600 shadow-sm">
              <StatIcon type="transit" />
            </div>
            <span className="text-xs font-medium text-cyan-600">
              Логистика
            </span>
          </div>
          <div className="mt-4 text-2xl font-semibold text-cyan-800">
            {counts?.inTransit ?? '—'}
          </div>
          <div className="mt-1 text-xs text-cyan-700/70">
            в пути / к получению
          </div>
        </button>
      </section>

      {!loading && attentionTasks.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-slate-950">
                  Требуют внимания
                </h2>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  {counts?.attention ?? '—'}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Самые важные действия на текущий момент
              </p>
            </div>

            {(counts?.attention ?? 0) > attentionTasks.length && (
              <button
                type="button"
                onClick={() => quickFilter({ view: 'attention' })}
                className="self-start text-sm font-semibold text-blue-600 hover:text-blue-700 sm:self-auto"
              >
                Показать все →
              </button>
            )}
          </div>

          <div className="grid divide-y divide-slate-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            {attentionTasks.map(({ task, reason }, index) => {
              const deadline = deadlineLabel(task);

              return (
                <Link
                  key={task.id}
                  href={taskLink(task.id, '/', list.query)}
                  className={`group flex min-w-0 gap-4 p-4 transition hover:bg-slate-50/80 sm:p-5 ${
                    index >= 2 ? 'hidden xl:flex' : ''
                  }`}
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-bold text-white">
                    {task.number}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900 transition group-hover:text-blue-700">
                          {task.title}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {statusLabels[task.status] ?? task.status}
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ring-1 ${attentionTone[reason.tone]}`}
                      >
                        {reason.label}
                      </span>
                    </div>

                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Следующее действие
                      </div>
                      <div className="mt-1 line-clamp-2 text-sm font-medium text-slate-700">
                        {task.nextAction || 'Не задано'}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className={deadline.className}>
                        {deadline.text}
                      </span>
                      {task.reminderAt && (
                        <span
                          className={
                            isReminderDue(task)
                              ? 'font-semibold text-amber-600'
                              : 'text-slate-400'
                          }
                        >
                          Напоминание {formatDateTime(task.reminderAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <DiscoveryControls entity="tasks" {...list} total={data?.total} />

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Загружаем закупки...
          </div>
        ) : loadError ? null : filteredTasks.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-xl text-slate-400">
              ⌕
            </div>
            <div className="mt-4 font-semibold text-slate-900">
              Закупки не найдены
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Измените поиск или параметры фильтрации.
            </div>
            <button
              type="button"
              onClick={() => quickFilter({})}
              className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              Сбросить фильтры
            </button>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Закупка</th>
                    <th className="px-5 py-3">Этап</th>
                    <th className="px-5 py-3">Приоритет</th>
                    <th className="px-5 py-3">Следующее действие</th>
                    <th className="px-5 py-3">Срок</th>
                    <th className="px-5 py-3">Позиций</th>
                    <th className="w-12 px-5 py-3" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredTasks.map((task) => {
                    const attention = getAttentionReason(task);
                    const deadline = deadlineLabel(task);

                    return (
                      <tr
                        key={task.id}
                        className="group transition hover:bg-slate-50/70"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 grid h-8 min-w-8 place-items-center rounded-lg bg-slate-100 px-1.5 text-xs font-semibold text-slate-500">
                              {task.number}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={taskLink(task.id, '/', list.query)}
                                  className="max-w-[300px] truncate font-semibold text-slate-950 transition group-hover:text-blue-700"
                                >
                                  {task.title}
                                </Link>
                                {attention && (
                                  <span
                                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${attentionTone[attention.tone]}`}
                                  >
                                    {attention.label}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 max-w-[340px] truncate text-xs text-slate-400">
                                {task.description ||
                                  `Создана ${formatDate(task.createdAt)}`}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              statusTone[task.status] ??
                              'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {statusLabels[task.status] ?? task.status}
                          </span>
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`text-sm font-medium ${
                              task.priority === 'URGENT'
                                ? 'text-rose-700'
                                : task.priority === 'HIGH'
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {priorityLabels[task.priority] ??
                              task.priority}
                          </span>
                        </td>

                        <td className="px-5 py-4">
                          <div className="max-w-[280px] text-slate-700">
                            {task.nextAction || (
                              <span className="text-slate-400">
                                Не задано
                              </span>
                            )}
                          </div>

                          {task.reminderAt && (
                            <div
                              className={`mt-1 text-xs ${
                                isReminderDue(task)
                                  ? 'font-semibold text-amber-600'
                                  : 'text-blue-600'
                              }`}
                            >
                              Напомнить {formatDateTime(task.reminderAt)}
                            </div>
                          )}
                        </td>

                        <td className="px-5 py-4">
                          <span className={deadline.className}>
                            {deadline.text}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-slate-500">
                          {task._count.items}
                        </td>

                        <td className="px-5 py-4 text-right">
                          <Link
                            href={taskLink(task.id, '/', list.query)}
                            aria-label={`Открыть закупку №${task.number}`}
                            className="inline-grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-blue-600 hover:shadow-sm"
                          >
                            →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 md:hidden">
              {filteredTasks.map((task) => {
                const attention = getAttentionReason(task);
                const deadline = deadlineLabel(task);

                return (
                  <Link
                    key={task.id}
                    href={taskLink(task.id, '/', list.query)}
                    className="block p-4 transition active:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-400">
                            №{task.number}
                          </span>
                          {attention && (
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${attentionTone[attention.tone]}`}
                            >
                              {attention.label}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 truncate font-semibold text-slate-900">
                          {task.title}
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          statusTone[task.status] ?? 'bg-slate-100'
                        }`}
                      >
                        {statusLabels[task.status] ?? task.status}
                      </span>
                    </div>

                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Следующее действие
                      </div>
                      <div className="mt-1">
                        {task.nextAction || 'Не задано'}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                      <span
                        className={
                          ['URGENT', 'HIGH'].includes(task.priority)
                            ? 'font-semibold text-rose-600'
                            : 'text-slate-400'
                        }
                      >
                        {priorityLabels[task.priority] ?? task.priority}
                      </span>
                      <span className={deadline.className}>
                        {deadline.text}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
        <Pagination page={data} onChange={list.setPage} />
      </section>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="w-full max-w-xl rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  Новая закупка
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Создайте карточку, затем добавьте закупаемые позиции.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  !isCreating && setIsCreateOpen(false)
                }
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100"
              >
                ×
              </button>
            </div>

            <form onSubmit={createTask} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">
                  Название *
                </span>
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Например: фильтры для планового ТО"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">
                  Описание
                </span>
                <textarea
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  rows={3}
                  placeholder="Что требуется закупить, для какого узла или работы..."
                  className="w-full resize-none rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">
                    Приоритет
                  </span>
                  <select
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="LOW">Низкий</option>
                    <option value="NORMAL">Обычный</option>
                    <option value="HIGH">Высокий</option>
                    <option value="URGENT">Срочный</option>
                  </select>
                </label>

                <label>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">
                    Срок
                  </span>
                  <input
                    type="datetime-local"
                    value={deadline}
                    onChange={(event) =>
                      setDeadline(event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-400"
                  />
                </label>
              </div>

              {createError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={isCreating}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Отмена
                </button>

                <button
                  type="submit"
                  disabled={isCreating || !title.trim()}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {isCreating ? 'Создаём...' : 'Создать закупку'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}


export default function Home() {
  return (
    <AuthGate>
      <Suspense><HomeContent /></Suspense>
    </AuthGate>
  );
}
