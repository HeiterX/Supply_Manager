'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input } from '@/app/components/ui';
import { apiFetch } from '@/lib/api-client';
import { apiError, apiMessage, ApiError, couldHaveSaved } from '@/lib/api-error';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { useRetryDelay } from '@/lib/use-retry-delay';

const fields = [
  { name: 'fullName', label: 'ФИО', type: 'text', required: true, min: 2, max: 120, autoComplete: 'name' },
  { name: 'department', label: 'Подразделение', type: 'text', max: 120 },
  { name: 'position', label: 'Должность', type: 'text', max: 120, autoComplete: 'organization-title' },
  { name: 'phone', label: 'Телефон', type: 'tel', max: 40, autoComplete: 'tel' },
  { name: 'email', label: 'Email', type: 'email', max: 160, autoComplete: 'email' },
  { name: 'username', label: 'Логин', type: 'text', required: true, min: 3, max: 40, autoComplete: 'username', hint: 'Латинские буквы, цифры, точка, дефис или подчёркивание.' },
  { name: 'password', label: 'Пароль', type: 'password', required: true, min: 10, max: 128, autoComplete: 'new-password', hint: 'Не менее 10 символов.' },
  { name: 'passwordConfirmation', label: 'Повторите пароль', type: 'password', required: true, max: 128, autoComplete: 'new-password' },
];
const labels = Object.fromEntries(fields.map(({ name, label }) => [name, label]));

export default function RegisterPage() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const waiting = useRetryDelay(retryAt);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focus = useFocusAfterRender();

  function showErrors(form: HTMLFormElement, next: Record<string, string>) {
    setErrors(next);
    focus(() => form.querySelector<HTMLElement>('[aria-invalid="true"]'));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || uncertain || waiting) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = Object.fromEntries(fields.filter(({ name }) => name !== 'passwordConfirmation').map(({ name, type }) => {
      const value = String(data.get(name) ?? '');
      return [name, (type === 'password' ? value : value.trim()) || undefined];
    }));
    const next: Record<string, string> = {};
    if ((payload.fullName?.length ?? 0) < 2) next.fullName = 'Укажите ФИО сотрудника.';
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(payload.username ?? '')) next.username = 'Введите от 3 до 40 допустимых символов.';
    if (payload.password !== data.get('passwordConfirmation')) next.passwordConfirmation = 'Пароли не совпадают.';
    if (payload.email && !form.querySelector<HTMLInputElement>('#register-email')?.validity.valid) next.email = 'Введите адрес электронной почты.';
    setMessage('');
    if (Object.keys(next).length) { showErrors(form, next); return; }

    lock.current = true;
    setBusy(true);
    setErrors({});
    try {
      const response = await apiFetch('/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!response.ok) throw await apiError(response, 'Не удалось создать учётную запись.', labels);
      setRegistered(true);
      focus(() => heading.current);
    } catch (error) {
      if (error instanceof ApiError) {
        setRetryAt(error.retryAt);
        if (error.status === 409) showErrors(form, { username: 'Логин или email уже используется. Проверьте оба поля.' });
        else if (Object.keys(error.fields).length) showErrors(form, error.fields);
      }
      const unknown = couldHaveSaved(error);
      setUncertain(unknown);
      setMessage(unknown ? 'Подтверждение не получено. Уточните у администратора, создана ли учётная запись.'
        : apiMessage(error, 'Не удалось создать учётную запись.'));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <main className="min-h-dvh px-4 py-6 sm:p-10">
    <Card className="mx-auto max-w-2xl space-y-5 p-4 sm:p-8">
      <div className="flex items-center gap-3"><span className="brand-mark" aria-hidden="true">SM</span><span className="font-semibold">Supply Manager</span></div>
      {registered ? <>
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold">Регистрация завершена</h1>
        <Alert tone="success">Учётная запись создана. После подтверждения администратором можно войти в систему.</Alert>
      </> : <>
        <h1 className="text-2xl font-bold">Создание учётной записи</h1>
        <p className="text-sm text-muted">После регистрации доступ подтвердит администратор.</p>
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={busy || uncertain} className="grid min-w-0 gap-4 sm:grid-cols-2">
            {fields.map(({ name, type, label, hint, required, min, max, autoComplete }) => {
              const id = `register-${name}`;
              return <Field key={name} id={id} label={label} hint={hint} error={errors[name]}>
                <Input id={id} name={name} type={type} required={required} minLength={min} maxLength={max} autoComplete={autoComplete}
                  onChange={() => setErrors((current) => ({ ...current, [name]: '' }))} />
              </Field>;
            })}
          </fieldset>
          {message && <Alert tone="danger">{message}</Alert>}
          <Button type="submit" loading={busy} disabled={uncertain || waiting}>
            {busy ? 'Создаём учётную запись…' : 'Создать учётную запись'}
          </Button>
        </form>
      </>}
      <Link href="/" className="ui-button ui-button--outline">{registered ? 'Перейти ко входу' : 'Уже есть учётная запись? Войти'}</Link>
    </Card>
  </main>;
}
