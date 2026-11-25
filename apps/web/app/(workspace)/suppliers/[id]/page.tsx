'use client';

import Link from 'next/link';
import { Suspense, use } from 'react';
import { useCoreResource } from '@/lib/discovery';
import PageLayout from '@/app/components/PageLayout';
import OrderDirectory from '@/app/components/OrderDirectory';
import type { Supplier } from '../page';

function SupplierContent({ id }: { id: string }) {
  const { data, loading, error } = useCoreResource<Supplier>(`/discovery/suppliers/${encodeURIComponent(id)}`);
  return (
    <PageLayout title={data?.name ?? 'Поставщик'}
      action={<Link href="/suppliers" className="text-sm font-semibold text-blue-700">К поставщикам</Link>}>
      {loading && <p role="status">Загружаем данные поставщика…</p>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {data && (
        <>
          <dl className="mb-5 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Контакт', data.contact], ['Телефон', data.phone], ['Почта', data.email], ['Сайт', data.website],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0"><dt className="text-sm text-slate-600">{label}</dt><dd className="break-words font-medium">{value ?? '—'}</dd></div>
            ))}
          </dl>
          <h2 className="mb-3 text-lg font-semibold">История заказов и закупок</h2>
          <Suspense><OrderDirectory supplierId={id} /></Suspense>
        </>
      )}
    </PageLayout>
  );
}

export default function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SupplierContent id={id} />;
}
