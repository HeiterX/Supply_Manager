'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { apiError, apiProblem, type ApiError } from '@/lib/api-error';
import { useAbortableLoad } from '@/lib/use-abortable-load';
import { useSession } from '@/app/components/AuthGate';
import LoadError from '@/app/components/LoadError';
import PageLayout from '@/app/components/PageLayout';
import { StatusBadge } from '@/app/components/StatusBadge';
import { Card, EmptyState, Skeleton, TableRegion } from '@/app/components/ui';

type Purchase = {
  id: string;
  number: number;
  title: string;
  status: string;
  deadline: string | null;
  reminderAt: string | null;
  createdAt: string;
};

const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' });

export default function DashboardPage() {
  const { user } = useSession();
  const employee = user.role === 'EMPLOYEE';
  return <PageLayout title={`Здравствуйте, ${user.fullName}`} subtitle="Обзор работы и быстрый доступ к разделам">
    <div className={employee ? '' : 'grid gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]'}>
      {employee ? null : <PurchaseSummary />}
      <Card className="self-start p-4">
        <h2 className="mb-2 font-semibold">Быстрые действия</h2>
        <div className="grid gap-1">
          <Link href="/request" className="app-nav-link">Подать заявку <span aria-hidden="true">›</span></Link>
          {employee ? <Link href="/my-requests" className="app-nav-link">Мои заявки <span aria-hidden="true">›</span></Link> : <>
            <Link href="/" className="app-nav-link">Открыть закупки <span aria-hidden="true">›</span></Link>
            <Link href="/requests" className="app-nav-link">Входящие заявки <span aria-hidden="true">›</span></Link>
            <Link href="/registry" className="app-nav-link">Найти позицию в реестре <span aria-hidden="true">›</span></Link>
          </>}
        </div>
      </Card>
    </div>
  </PageLayout>;
}

function PurchaseSummary() {
  const [purchases, setPurchases] = useState<Purchase[]>();
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string | ApiError>('');
  const load = useCallback(async (signal: AbortSignal) => {
    setError('');
    try {
      const response = await apiFetch('/tasks', { signal });
      if (!response.ok) throw await apiError(response, 'Не удалось загрузить обзор закупок.');
      const data: Purchase[] = await response.json();
      if (!signal.aborted) {
        setLoadedAt(Date.now());
        setPurchases(data);
      }
    } catch (error) {
      if (!signal.aborted) setError(apiProblem(error, 'Не удалось загрузить обзор закупок.'));
    }
  }, []);
  const reload = useAbortableLoad(load);

  if (error) return <LoadError message={error} retry={() => void reload()} />;
  if (!purchases) return <Skeleton label="Загрузка обзора закупок" />;

  const active = purchases.filter(({ status }) => status !== 'CLOSED' && status !== 'CANCELLED');
  const overdue = active.filter(({ deadline }) => deadline && Date.parse(deadline) < loadedAt);
  const reminders = active.filter(({ reminderAt }) => reminderAt && Date.parse(reminderAt) <= loadedAt);
  const recent = purchases.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);

  return <div className="grid min-w-0 content-start gap-5">
    <dl className="grid gap-3 sm:grid-cols-3">
      {[
        ['Активные закупки', active.length],
        ['Просроченные закупки', overdue.length],
        ['Наступившие напоминания', reminders.length],
      ].map(([label, count]) => <Card key={label} className="p-4">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="mt-1 text-2xl font-bold tabular-nums">{count}</dd>
      </Card>)}
    </dl>
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <h2 className="font-semibold">Недавние закупки</h2>
        <Link href="/" className="text-sm font-semibold text-accent hover:underline">Все закупки →</Link>
      </div>
      {recent.length ? <TableRegion label="Недавние закупки">
        <table className="min-w-[27rem]">
          <thead><tr><th scope="col">Закупка</th><th scope="col">Статус</th><th scope="col">Срок</th></tr></thead>
          <tbody>{recent.map((purchase) => <tr key={purchase.id}>
            <td className="min-w-36"><Link href={`/tasks/${purchase.id}`} className="font-semibold text-accent hover:underline">№ {purchase.number} · {purchase.title}</Link></td>
            <td><StatusBadge status={purchase.status} /></td>
            <td className="whitespace-nowrap text-muted">{purchase.deadline ? date.format(new Date(purchase.deadline)) : '—'}</td>
          </tr>)}</tbody>
        </table>
      </TableRegion> : <p className="p-4 pt-0 text-sm text-muted">Закупок пока нет.</p>}
    </Card>
    <section aria-labelledby="overdue-heading" className="grid gap-2">
      <h2 id="overdue-heading" className="font-semibold">Закупки с истекшим сроком</h2>
      {overdue.length ? <Card className="divide-y divide-slate-100 px-4">{overdue.slice(0, 5).map((purchase) =>
        <Link className="block py-3 text-sm text-accent hover:underline" key={purchase.id} href={`/tasks/${purchase.id}`}>№ {purchase.number} · {purchase.title}</Link>)}</Card> :
        <EmptyState title="Просроченных закупок нет" />}
    </section>
  </div>;
}
