'use client';

import { Suspense } from 'react';
import AppShell from '../components/AppShell';
import AuthGate, { useCurrentUser } from '../components/AuthGate';
import { DiscoveryControls, Pagination, buttonClass } from '../components/DiscoveryControls';
import { useDiscoveryList } from '../../lib/discovery';
import RequestCard, { type PurchaseRequest } from './RequestCard';

function RequestsContent() {
  const employee = useCurrentUser()?.role === 'EMPLOYEE';
  const list = useDiscoveryList<PurchaseRequest>('requests');
  const { data, loading, error } = list;
  return (
    <AppShell title={employee ? 'Мои заявки' : 'Входящие заявки'}
      action={<button type="button" className={buttonClass} onClick={() => void list.reload()}>Обновить</button>}>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <DiscoveryControls entity="requests" {...list} total={data?.total} />
      </section>
      {loading && <p role="status" className="p-5 text-sm text-slate-500">Загружаем заявки…</p>}
      {error && <p role="alert" className="p-5 text-sm text-rose-700">{error}</p>}
      {data?.items.length === 0 && <p className="p-5 text-sm text-slate-600">Заявок не найдено.</p>}
      <div className="mt-5 space-y-4">
        {data?.items.map((request) => (
          <RequestCard key={request.id} request={request} onAccepted={() => {
            if (list.query.has('status')) {
              const next = new URLSearchParams(list.query);
              next.delete('status');
              next.delete('page');
              list.change(next);
            } else {
              void list.reload();
            }
          }} />
        ))}
      </div>
      <Pagination page={data} onChange={list.setPage} />
    </AppShell>
  );
}

export default function RequestsPage() {
  return <AuthGate allowEmployees><Suspense><RequestsContent /></Suspense></AuthGate>;
}
