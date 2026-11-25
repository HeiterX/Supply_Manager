
'use client';

import { useEffect, useMemo, useState } from 'react';

import AppShell from '../../components/AppShell';
import AuthGate from '../../components/AuthGate';
import PageLayout from '../../components/PageLayout';

import { apiFetch } from '../../../lib/api-client';
import { getCurrentUser } from '../../../lib/auth';

type UserRole = 'EMPLOYEE' | 'PROCUREMENT' | 'ADMIN';
type UserStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED';

type AdminUser = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  department: string | null;
  position: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
};

const roleLabels: Record<UserRole, string> = {
  EMPLOYEE: 'Сотрудник',
  PROCUREMENT: 'Снабженец',
  ADMIN: 'Администратор',
};

const statusLabels: Record<UserStatus, string> = {
  PENDING: 'Ожидает активации',
  ACTIVE: 'Активен',
  BLOCKED: 'Заблокирован',
};

const statusStyles: Record<UserStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  BLOCKED: 'bg-rose-50 text-rose-700',
};

function getErrorMessage(
  data: unknown,
  fallback: string,
): string {
  if (!data || typeof data !== 'object') {
    return fallback;
  }

  const message = (data as { message?: unknown }).message;

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message)) {
    return message.join('; ');
  }

  return fallback;
}

function AdminUsersContent() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [access, setAccess] = useState<
    'checking' | 'ready' | 'forbidden' | 'error'
  >('checking');

  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const user = await getCurrentUser();

        if (!active) return;

        if (!user || user.role !== 'ADMIN') {
          setAccess('forbidden');
          return;
        }

        const response = await apiFetch('/admin/users', {
          cache: 'no-store',
        });

        const data = (await response.json().catch(
          () => null,
        )) as unknown;

        if (!active) return;

        if (!response.ok) {
          throw new Error(
            getErrorMessage(
              data,
              'Не удалось получить пользователей',
            ),
          );
        }

        if (!Array.isArray(data)) {
          throw new Error(
            'Сервер вернул некорректный список',
          );
        }

        setCurrentUserId(user.id);
        setUsers(data as AdminUser[]);
        setAccess('ready');
      } catch (err) {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : 'Ошибка загрузки',
        );
        setAccess('error');
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return users.filter((user) =>
      [
        user.fullName,
        user.username,
        user.email ?? '',
        user.department ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [users, search]);

  async function refreshUsers() {
    setRefreshing(true);
    setError('');

    try {
      const response = await apiFetch('/admin/users', {
        cache: 'no-store',
      });

      const data = (await response.json().catch(
        () => null,
      )) as unknown;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, 'Ошибка обновления'),
        );
      }

      if (!Array.isArray(data)) {
        throw new Error('Некорректный ответ сервера');
      }

      setUsers(data as AdminUser[]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось обновить список',
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function updateUser(
    user: AdminUser,
    action: 'activate' | 'block' | 'role',
    role?: UserRole,
  ) {
    if (busyId || refreshing) return;

    const description =
      action === 'activate'
        ? `Активировать ${user.fullName}?`
        : action === 'block'
          ? `Заблокировать ${user.fullName}?`
          : `Изменить роль ${user.fullName} на ${
              role ? roleLabels[role] : ''
            }?`;

    if (!window.confirm(description)) return;

    setBusyId(user.id);
    setError('');
    setNotice('');

    try {
      const response = await apiFetch(
        `/admin/users/${user.id}/${action}`,
        {
          method: 'PATCH',
          ...(action === 'role'
            ? {
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ role }),
              }
            : {}),
        },
      );

      const data = (await response.json().catch(
        () => null,
      )) as unknown;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            data,
            'Не удалось изменить пользователя',
          ),
        );
      }

      const updatedUser = data as AdminUser;

      setUsers((current) =>
        current.map((item) =>
          item.id === user.id ? updatedUser : item,
        ),
      );

      setNotice('Изменения успешно сохранены.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Ошибка изменения пользователя',
      );
    } finally {
      setBusyId('');
    }
  }

  if (access === 'checking') {
    return (
      <div className="p-8 text-center text-slate-500">
        Проверяем права администратора...
      </div>
    );
  }

  if (access === 'forbidden') {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-rose-200 bg-white p-8">
        <h1 className="text-xl font-semibold">
          Доступ запрещён
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Управлять пользователями может только
          администратор Supply Manager.
        </p>
      </div>
    );
  }

  if (access === 'error') {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-2xl border bg-white p-8">
        <h1 className="text-xl font-semibold">
          Не удалось открыть раздел
        </h1>
        <p className="mt-3 text-sm text-rose-600">
          {error}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          Повторить
        </button>
      </div>
    );
  }

  const pendingCount = users.filter(
    (user) => user.status === 'PENDING',
  ).length;

  const activeCount = users.filter(
    (user) => user.status === 'ACTIVE',
  ).length;

  return (
    <PageLayout
      title="Управление пользователями"
      subtitle="Сотрудники, роли и доступ к Supply Manager"
      action={
        <button
          type="button"
          onClick={() => void refreshUsers()}
          disabled={refreshing || Boolean(busyId)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {refreshing ? 'Обновляем...' : 'Обновить'}
        </button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Пользователей в списке', value: users.length },
          { label: 'Активных', value: activeCount },
          { label: 'Ожидают активации', value: pendingCount },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="text-3xl font-semibold">
              {stat.value}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-600">
          Поиск сотрудника
          <input
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="ФИО, логин, почта или отдел"
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
          />
        </label>
      </section>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700"
        >
          {notice}
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-5 py-4 font-medium">
                  Сотрудник
                </th>
                <th className="px-5 py-4 font-medium">
                  Отдел
                </th>
                <th className="px-5 py-4 font-medium">
                  Статус
                </th>
                <th className="px-5 py-4 font-medium">
                  Роль
                </th>
                <th className="px-5 py-4 font-medium">
                  Действия
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((user) => {
                const isSelf =
                  user.id === currentUserId;

                const disabled =
                  Boolean(busyId) || refreshing;

                return (
                  <tr
                    key={user.id}
                    className="align-middle"
                  >
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-900">
                        {user.fullName}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        @{user.username}
                      </div>
                    </td>

                    <td className="px-5 py-4 text-slate-600">
                      {user.department || '—'}
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${statusStyles[user.status]}`}
                      >
                        {statusLabels[user.status]}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <select
                        aria-label={`Роль пользователя ${user.fullName}`}
                        value={user.role}
                        disabled={disabled || isSelf}
                        onChange={(event) => {
                          const nextRole =
                            event.target.value as UserRole;

                          if (nextRole !== user.role) {
                            void updateUser(
                              user,
                              'role',
                              nextRole,
                            );
                          }
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-50"
                      >
                        <option value="EMPLOYEE">
                          Сотрудник
                        </option>
                        <option value="PROCUREMENT">
                          Снабженец
                        </option>
                        <option value="ADMIN">
                          Администратор
                        </option>
                      </select>
                    </td>

                    <td className="px-5 py-4">
                      {user.status === 'PENDING' && (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            void updateUser(
                              user,
                              'activate',
                            )
                          }
                          className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
                        >
                          Активировать
                        </button>
                      )}

                      {user.status === 'ACTIVE' &&
                        !isSelf && (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              void updateUser(
                                user,
                                'block',
                              )
                            }
                            className="rounded-xl border border-rose-200 px-4 py-2 font-medium text-rose-700 disabled:opacity-50"
                          >
                            Заблокировать
                          </button>
                        )}

                      {user.status === 'ACTIVE' &&
                        isSelf && (
                          <span className="text-xs text-slate-400">
                            Ваша учётная запись
                          </span>
                        )}

                      {user.status === 'BLOCKED' && (
                        <span className="text-xs text-slate-400">
                          Разблокировка пока недоступна
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="p-8 text-center text-slate-500">
            Сотрудников не найдено.
          </div>
        )}
      </section>

      <p className="mt-4 text-xs text-slate-400">
        Сейчас API возвращает до 50 последних пользователей.
        Полную пагинацию добавим отдельно.
      </p>
    </PageLayout>
  );
}

export default function AdminUsersPage() {
  return (
    <AuthGate>
      <AppShell><AdminUsersContent /></AppShell>
    </AuthGate>
  );
}
