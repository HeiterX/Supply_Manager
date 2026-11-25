'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useDiscoveryList } from '../../lib/discovery';
import AppShell from '../components/AppShell';
import AuthGate from '../components/AuthGate';
import { DiscoveryControls, Pagination } from '../components/DiscoveryControls';

export type Supplier = { id: string; name: string; contact: string | null; email: string | null; phone: string | null; website: string | null };

function SuppliersContent() {
  const list = useDiscoveryList<Supplier>('suppliers');
  const { data, loading, error } = list;
  return (
    <AppShell title="Поставщики">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <DiscoveryControls entity="suppliers" {...list} total={data?.total} />
        {loading && <p role="status" className="p-5 text-sm text-slate-500">Загружаем поставщиков…</p>}
        {error && <p role="alert" className="p-5 text-sm text-rose-700">{error}</p>}
        {data?.items.length === 0 && <p className="p-5 text-sm text-slate-600">Поставщиков не найдено.</p>}
        <ul className="divide-y divide-slate-100">
          {data?.items.map((supplier) => (
            <li key={supplier.id} className="grid gap-2 p-4 sm:grid-cols-3 sm:p-5">
              <Link href={`/suppliers/${supplier.id}`} className="min-w-0 break-words font-semibold text-blue-700 hover:underline">{supplier.name}</Link>
              <span className="min-w-0 break-words text-sm text-slate-700">{supplier.contact ?? '—'}</span>
              <span className="min-w-0 break-words text-sm text-slate-700">{supplier.email ?? supplier.phone ?? '—'}</span>
            </li>
          ))}
        </ul>
        <Pagination page={data} onChange={list.setPage} />
      </section>
    </AppShell>
  );
}

export default function SuppliersPage() {
  return <AuthGate><Suspense><SuppliersContent /></Suspense></AuthGate>;
}
