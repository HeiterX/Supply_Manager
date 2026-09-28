'use client';

import { FormEvent, useEffect, useState } from 'react';

type Task = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

const API_URL = 'http://localhost:3000/api/v1';

const statusLabels: Record<string, string> = {
  NEW: 'Новая',
  SEARCHING: 'Поиск поставщика',
  NEGOTIATION: 'Переговоры',
  ORDERED: 'Заказано',
  WAITING_PAYMENT: 'Ожидает оплаты',
  WAITING_SHIPMENT: 'Ожидает отправки',
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

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [deadline, setDeadline] = useState('');

  useEffect(() => {
    async function loadTasks() {
      try {
        setLoadError('');

        const response = await fetch(`${API_URL}/tasks`);

        if (!response.ok) {
          throw new Error('Не удалось загрузить задачи');
        }

        const data = (await response.json()) as Task[];
        setTasks(data);
      } catch (error) {
        console.error(error);
        setLoadError(
          'Не удалось получить задачи. Проверьте, что API запущен.',
        );
      } finally {
        setLoading(false);
      }
    }

    void loadTasks();
  }, []);

  function resetCreateForm() {
    setTitle('');
    setDescription('');
    setPriority('NORMAL');
    setDeadline('');
    setCreateError('');
  }

  function openCreateModal() {
    resetCreateForm();
    setIsCreateOpen(true);
  }

  function closeCreateModal() {
    if (isCreating) {
      return;
    }

    setIsCreateOpen(false);
    resetCreateForm();
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setCreateError('Введите название задачи.');
      return;
    }

    setIsCreating(true);
    setCreateError('');

    try {
      const response = await fetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: trimmedTitle,
          description: description.trim() || undefined,
          priority,
          deadline: deadline
            ? new Date(deadline).toISOString()
            : undefined,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();

        console.error('Create task error:', errorBody);

        throw new Error('Не удалось создать задачу');
      }

      const createdTask = (await response.json()) as Task;

      setTasks((currentTasks) => [createdTask, ...currentTasks]);

      resetCreateForm();
      setIsCreateOpen(false);
    } catch (error) {
      console.error(error);

      setCreateError(
        'Не удалось создать задачу. Проверьте подключение к API.',
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-10 flex items-center justify-between gap-6">
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-500">
              Система управления снабжением
            </p>

            <h1 className="text-4xl font-semibold tracking-tight">
              Supply Manager
            </h1>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-xl bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            + Новая задача
          </button>
        </header>

        <section className="mb-6 flex items-end justify-between gap-6">
          <div>
            <h2 className="text-2xl font-semibold">Задачи</h2>

            <p className="mt-1 text-sm text-zinc-500">
              Все текущие закупки и задачи по снабжению
            </p>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm">
            Всего: {tasks.length}
          </div>
        </section>

        {loading ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8">
            Загружаем задачи...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
            <p className="font-medium text-red-800">
              Не удалось загрузить задачи
            </p>

            <p className="mt-1 text-sm text-red-600">
              {loadError}
            </p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
            <h3 className="font-semibold">
              Задач пока нет
            </h3>

            <p className="mt-2 text-sm text-zinc-500">
              Создайте первую задачу на закупку.
            </p>

            <button
              type="button"
              onClick={openCreateModal}
              className="mt-5 rounded-xl bg-zinc-950 px-5 py-3 text-sm font-medium text-white"
            >
              + Новая задача
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <article
                key={task.id}
                className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-400">
                        №{task.number}
                      </span>

                      <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium">
                        {statusLabels[task.status] ?? task.status}
                      </span>

                      <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium">
                        {priorityLabels[task.priority] ?? task.priority}
                      </span>
                    </div>

                    <h3 className="text-lg font-semibold">
                      {task.title}
                    </h3>

                    {task.description && (
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                        {task.description}
                      </p>
                    )}

                    {task.deadline && (
                      <div className="mt-4">
                        <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                          Дедлайн:{' '}
                          {new Date(task.deadline).toLocaleString('ru-RU')}
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50"
                  >
                    Открыть
                  </button>
                </div>

                <div className="mt-5 border-t border-zinc-100 pt-4 text-xs text-zinc-400">
                  Создано:{' '}
                  {new Date(task.createdAt).toLocaleString('ru-RU')}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">
                  Новая задача
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Добавьте новую задачу по снабжению
                </p>
              </div>

              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isCreating}
                className="rounded-lg px-3 py-2 text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={createTask}
              className="space-y-5"
            >
              <div>
                <label
                  htmlFor="task-title"
                  className="mb-2 block text-sm font-medium"
                >
                  Что нужно сделать?
                </label>

                <input
                  id="task-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Например: заказать подшипники SKF"
                  required
                  autoFocus
                  className="w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none transition focus:border-zinc-500"
                />
              </div>

              <div>
                <label
                  htmlFor="task-description"
                  className="mb-2 block text-sm font-medium"
                >
                  Описание
                </label>

                <textarea
                  id="task-description"
                  value={description}
                  onChange={(event) =>
                    setDescription(event.target.value)
                  }
                  placeholder="Количество, характеристики, пожелания исполнителя..."
                  rows={4}
                  className="w-full resize-none rounded-xl border border-zinc-200 px-4 py-3 outline-none transition focus:border-zinc-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="task-priority"
                    className="mb-2 block text-sm font-medium"
                  >
                    Приоритет
                  </label>

                  <select
                    id="task-priority"
                    value={priority}
                    onChange={(event) =>
                      setPriority(event.target.value)
                    }
                    className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 outline-none"
                  >
                    <option value="LOW">
                      Низкий
                    </option>

                    <option value="NORMAL">
                      Обычный
                    </option>

                    <option value="HIGH">
                      Высокий
                    </option>

                    <option value="URGENT">
                      Срочный
                    </option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="task-deadline"
                    className="mb-2 block text-sm font-medium"
                  >
                    Дедлайн
                  </label>

                  <input
                    id="task-deadline"
                    type="datetime-local"
                    value={deadline}
                    onChange={(event) =>
                      setDeadline(event.target.value)
                    }
                    className="w-full rounded-xl border border-zinc-200 px-4 py-3 outline-none"
                  />
                </div>
              </div>

              {createError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-zinc-100 pt-5">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={isCreating}
                  className="rounded-xl border border-zinc-200 px-5 py-3 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-50"
                >
                  Отмена
                </button>

                <button
                  type="submit"
                  disabled={isCreating || !title.trim()}
                  className="rounded-xl bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating
                    ? 'Создаём...'
                    : 'Создать задачу'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}