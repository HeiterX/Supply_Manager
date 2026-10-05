'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

type RegisterForm = {
  fullName: string;
  department: string;
  position: string;
  phone: string;
  email: string;
  username: string;
  password: string;
  passwordConfirmation: string;
};

const initialForm: RegisterForm = {
  fullName: '',
  department: '',
  position: '',
  phone: '',
  email: '',
  username: '',
  password: '',
  passwordConfirmation: '',
};

function getErrorMessage(data: unknown) {
  if (!data || typeof data !== 'object') {
    return 'Не удалось выполнить регистрацию';
  }

  const message = (data as { message?: unknown }).message;

  if (Array.isArray(message)) {
    return message.join('. ');
  }

  if (typeof message === 'string') {
    return message;
  }

  return 'Не удалось выполнить регистрацию';
}

export default function RegisterPage() {
  const [form, setForm] = useState<RegisterForm>(initialForm);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);

  function updateField(field: keyof RegisterForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    if (error) {
      setError('');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const fullName = form.fullName.trim();
    const username = form.username.trim();

    if (fullName.length < 2) {
      setError('Укажите ФИО сотрудника');
      return;
    }

    if (username.length < 3) {
      setError('Логин должен содержать минимум 3 символа');
      return;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      setError(
        'Логин может содержать только латинские буквы, цифры, точку, дефис и подчёркивание',
      );
      return;
    }

    if (form.password.length < 10) {
      setError('Пароль должен содержать минимум 10 символов');
      return;
    }

    if (form.password !== form.passwordConfirmation) {
      setError('Пароли не совпадают');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName,
          username,
          password: form.password,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          department: form.department.trim() || undefined,
          position: form.position.trim() || undefined,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getErrorMessage(data));
      }

      setIsRegistered(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось связаться с сервером',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isRegistered) {
    return (
      <main className="min-h-screen bg-[#f5f7fb] px-4 py-8 sm:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
          <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-7 w-7 text-emerald-600"
                aria-hidden="true"
              >
                <path
                  d="m5 12 4 4L19 6"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="mt-6 text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-600">
                Заявка принята
              </p>

              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                Регистрация завершена
              </h1>

              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-500 sm:text-base">
                Учётная запись создана и ожидает подтверждения администратора.
                После активации вы сможете войти в систему и подавать заявки на
                закупку.
              </p>
            </div>

            <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">
                  !
                </div>

                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    Ожидается подтверждение
                  </p>
                  <p className="mt-1 text-sm leading-5 text-amber-700">
                    До активации учётной записи вход в рабочую систему будет
                    недоступен.
                  </p>
                </div>
              </div>
            </div>

            <Link
              href="/login"
              className="mt-7 flex h-12 w-full items-center justify-center rounded-xl bg-[#3d66f5] px-5 text-sm font-semibold text-white transition hover:bg-[#3157df]"
            >
              Перейти ко входу
            </Link>

            <Link
              href="/"
              className="mt-3 flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            >
              На главную
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb]">
      <div className="mx-auto grid min-h-screen max-w-[1440px] lg:grid-cols-[0.82fr_1.18fr]">
        <section className="relative hidden overflow-hidden bg-[#315cf4] p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div
            className="absolute -right-28 -top-28 h-96 w-96 rounded-full border border-white/10"
            aria-hidden="true"
          />
          <div
            className="absolute -right-10 -top-10 h-64 w-64 rounded-full border border-white/10"
            aria-hidden="true"
          />
          <div
            className="absolute -bottom-36 -left-28 h-96 w-96 rounded-full bg-white/[0.04]"
            aria-hidden="true"
          />

          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white font-bold text-[#315cf4] shadow-sm">
              SM
            </div>
            <div>
              <div className="font-semibold">Supply Manager</div>
              <div className="mt-0.5 text-sm text-blue-100">
                Снабжение и закупки
              </div>
            </div>
          </div>

          <div className="relative z-10 max-w-lg">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path
                  d="M8 7h8M8 11h8M8 15h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <h2 className="text-4xl font-bold leading-tight tracking-tight">
              Закупки начинаются
              <br />
              с простой заявки
            </h2>

            <p className="mt-5 max-w-md text-base leading-7 text-blue-100">
              Создайте рабочую учётную запись, чтобы отправлять заявки на
              материалы и комплектующие и отслеживать их выполнение.
            </p>

            <div className="mt-9 space-y-4">
              {[
                'Подача заявки за несколько минут',
                'Несколько позиций в одной заявке',
                'Контроль статуса закупки',
              ].map((text) => (
                <div key={text} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      className="h-3.5 w-3.5"
                    >
                      <path
                        d="m4 10 3.5 3.5L16 5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="text-sm text-blue-50">{text}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="relative z-10 text-xs text-blue-200">
            Внутренняя система управления снабжением
          </p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-8 lg:px-12">
          <div className="w-full max-w-2xl">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3d66f5] text-sm font-bold text-white">
                SM
              </div>
              <div>
                <div className="text-sm font-bold text-slate-950">
                  Supply Manager
                </div>
                <div className="text-xs text-slate-500">
                  Снабжение и закупки
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-8 lg:p-10">
              <div>
                <p className="text-sm font-semibold text-[#3d66f5]">
                  Регистрация сотрудника
                </p>

                <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                  Создание учётной записи
                </h1>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Заполните рабочие данные. После регистрации учётную запись
                  подтвердит администратор.
                </p>
              </div>

              <form className="mt-8" onSubmit={handleSubmit}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="ФИО"
                    required
                    value={form.fullName}
                    onChange={(value) => updateField('fullName', value)}
                    placeholder="Иванов Иван Иванович"
                    autoComplete="name"
                  />

                  <Field
                    label="Подразделение"
                    value={form.department}
                    onChange={(value) => updateField('department', value)}
                    placeholder="Механическая служба"
                  />

                  <Field
                    label="Должность"
                    value={form.position}
                    onChange={(value) => updateField('position', value)}
                    placeholder="Инженер"
                  />

                  <Field
                    label="Телефон"
                    value={form.phone}
                    onChange={(value) => updateField('phone', value)}
                    placeholder="+7 900 000-00-00"
                    type="tel"
                    autoComplete="tel"
                  />

                  <Field
                    label="Email"
                    value={form.email}
                    onChange={(value) => updateField('email', value)}
                    placeholder="ivanov@company.ru"
                    type="email"
                    autoComplete="email"
                  />

                  <Field
                    label="Логин"
                    required
                    value={form.username}
                    onChange={(value) => updateField('username', value)}
                    placeholder="ivanov.i"
                    autoComplete="username"
                    hint="Латиница, цифры, точка, дефис или _"
                  />

                  <Field
                    label="Пароль"
                    required
                    value={form.password}
                    onChange={(value) => updateField('password', value)}
                    placeholder="Минимум 10 символов"
                    type="password"
                    autoComplete="new-password"
                    hint="Не менее 10 символов"
                  />

                  <Field
                    label="Повторите пароль"
                    required
                    value={form.passwordConfirmation}
                    onChange={(value) =>
                      updateField('passwordConfirmation', value)
                    }
                    placeholder="Повторите пароль"
                    type="password"
                    autoComplete="new-password"
                  />
                </div>

                {error && (
                  <div
                    className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700"
                    role="alert"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-7 flex h-12 w-full items-center justify-center rounded-xl bg-[#3d66f5] px-5 text-sm font-semibold text-white transition hover:bg-[#3157df] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting
                    ? 'Создаём учётную запись...'
                    : 'Создать учётную запись'}
                </button>

                <p className="mt-5 text-center text-sm text-slate-500">
                  Уже зарегистрированы?{' '}
                  <Link
                    href="/login"
                    className="font-semibold text-[#315cf4] hover:underline"
                  >
                    Войти
                  </Link>
                </p>
              </form>
            </div>

            <p className="mt-5 text-center text-xs leading-5 text-slate-400">
              Регистрируясь, сотрудник получает доступ только после
              подтверждения учётной записи.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-800">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>

      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-[#6d89f7] focus:ring-4 focus:ring-[#3d66f5]/10"
      />

      {hint && (
        <span className="mt-1.5 block text-xs text-slate-400">{hint}</span>
      )}
    </label>
  );
}
