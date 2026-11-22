'use client';

import Link from 'next/link';
import { Suspense, useRef, useState, type FormEvent } from 'react';
import PageLayout from '@/app/components/PageLayout';
import { Modal, ModalActions } from '@/app/components/Modal';
import { StatusBadge, taskStatusLabels } from '@/app/components/StatusBadge';
import { WorkingTable, WorkingTableControls } from '@/app/components/WorkingTable';
import { Alert, Button, Field, Input, Select, Skeleton, Textarea, Toast } from '@/app/components/ui';
import { apiFetch } from '@/lib/api-client';
import { apiError, apiMessage, ApiError, couldHaveSaved } from '@/lib/api-error';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { useRetryDelay } from '@/lib/use-retry-delay';
import { priorityLabels, useWorkingList, workingDate, workingLink } from '@/lib/working-list';

type TaskRow = {
  id: string; number: number; title: string; status: string; priority: string;
  createdAt: string; deadline: string | null; nextAction: string | null;
};

function CreatePurchase({ close, onCreated }: { close: (reconcile: boolean) => void; onCreated: (task: TaskRow) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [failure, setFailure] = useState<ApiError>();
  const waiting = useRetryDelay(failure?.retryAt);
  const pending = useRef(false);
  const focus = useFocusAfterRender();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || uncertain || waiting) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    if (!title) { setNameError('Введите название закупки.'); event.currentTarget.querySelector('input')?.focus(); return; }
    const deadline = String(data.get('deadline') ?? '');
    pending.current = true;
    setBusy(true);
    setError('');
    setFailure(undefined);
    try {
      const response = await apiFetch('/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: String(data.get('description') ?? '').trim() || undefined,
          priority: data.get('priority'), deadline: deadline ? new Date(deadline).toISOString() : undefined }),
      });
      if (!response.ok) throw await apiError(response, 'Не удалось создать закупку.', {
        title: 'Название', description: 'Описание', priority: 'Приоритет', deadline: 'Срок',
      });
      const task = await response.json() as TaskRow;
      if (!task?.id || !Number.isInteger(task.number)) throw new Error();
      onCreated(task);
    } catch (failure) {
      if (failure instanceof ApiError) {
        setFailure(failure);
        if (Object.keys(failure.fields).length) focus(() => form.querySelector<HTMLElement>('[aria-invalid="true"]'));
      }
      const unknown = couldHaveSaved(failure);
      setUncertain(unknown);
      setError(unknown ? 'Подтверждение не получено. Проверьте список закупок перед повторным созданием.'
        : apiMessage(failure, 'Не удалось создать закупку.'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Modal title="Новая закупка" onClose={() => close(uncertain)} busy={busy}>
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy || uncertain} className="min-w-0 space-y-4">
        <Field id="purchase-title" label="Название" error={nameError || failure?.fields.title}>
          <Input id="purchase-title" name="title" required maxLength={250} data-initial-focus
            aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'purchase-title-error' : undefined}
            onChange={() => { setNameError(''); if (failure?.fields.title) setFailure(undefined); }} />
        </Field>
        <Field id="purchase-description" label="Описание" error={failure?.fields.description}>
          <Textarea id="purchase-description" name="description" rows={3} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="purchase-priority" label="Приоритет" error={failure?.fields.priority}><Select id="purchase-priority" name="priority" defaultValue="NORMAL">
            {Object.entries(priorityLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </Select></Field>
          <Field id="purchase-deadline" label="Срок (местное время)" error={failure?.fields.deadline}>
            <Input id="purchase-deadline" name="deadline" type="datetime-local" />
          </Field>
        </div>
      </fieldset>
      {error && <Alert tone="danger">{error}</Alert>}
      {uncertain ? <Button variant="outline" onClick={() => close(true)}>Вернуться к списку</Button>
        : <ModalActions busy={busy} disabled={waiting} onCancel={() => close(false)} submitLabel="Создать закупку" />}
    </form>
  </Modal>;
}

function Purchases() {
  const list = useWorkingList<TaskRow>('tasks');
  const [create, setCreate] = useState(false);
  const [created, setCreated] = useState<TaskRow | null>(null);

  return <PageLayout title="Закупки" subtitle={list.page ? `Закупок по текущему виду: ${list.page.total}` : undefined}
    action={<Button onClick={() => setCreate(true)}>Создать закупку</Button>}>
    <div className="min-w-0 space-y-4">
      <WorkingTableControls list={list} statuses={Object.entries(taskStatusLabels)} purchases />
      <WorkingTable list={list} label="Закупки" empty="Закупок по текущему виду нет"
        headers={['Закупка', 'Статус', 'Приоритет', 'Создана', 'Срок', 'Следующее действие']}>
        {list.page?.items.map((task) => <tr key={task.id} className="hover:bg-accent-soft/50">
          <th scope="row" className="min-w-56 whitespace-normal text-left">
            <Link href={workingLink(`/tasks/${task.id}`, list.href)} className="block [overflow-wrap:anywhere] text-accent hover:underline">
              <span className="block text-xs text-muted">№{task.number}</span>{task.title}
            </Link>
          </th>
          <td data-label="Статус"><StatusBadge status={task.status} /></td>
          <td data-label="Приоритет">{priorityLabels[task.priority] ?? task.priority}</td>
          <td data-label="Создана" className="whitespace-nowrap">{workingDate(task.createdAt)}</td>
          <td data-label="Срок" className="whitespace-nowrap">{workingDate(task.deadline)}</td>
          <td data-label="Следующее действие" className="min-w-48 break-words">{task.nextAction || 'Не указано'}</td>
        </tr>)}
      </WorkingTable>
    </div>
    {create && <CreatePurchase close={(reconcile) => { setCreate(false); if (reconcile) list.reload(); }} onCreated={(task) => {
      setCreate(false); setCreated(task); list.reload();
    }} />}
    {created && <Toast onDismiss={() => setCreated(null)}>
      <Link className="underline" href={workingLink(`/tasks/${created.id}`, list.href)}>Открыть закупку №{created.number}</Link>
    </Toast>}
  </PageLayout>;
}

export default function PurchasesPage() {
  return <Suspense fallback={<PageLayout title="Закупки"><Skeleton /></PageLayout>}><Purchases /></Suspense>;
}
