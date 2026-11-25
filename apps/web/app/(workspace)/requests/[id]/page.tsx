'use client';

import Link from 'next/link';
import { use } from 'react';
import { useCoreResource } from '@/lib/discovery';
import PageLayout from '@/app/components/PageLayout';
import RequestCard, { type PurchaseRequest } from '../RequestCard';

function RequestContent({ id }: { id: string }) {
  const { data, loading, error, reload } = useCoreResource<PurchaseRequest>(`/purchase-requests/${encodeURIComponent(id)}`);
  return (
    <PageLayout title={data ? `Заявка №${data.number}` : 'Заявка'}
      action={<Link className="text-sm font-semibold text-blue-700" href="/requests">К заявкам</Link>}>
      {loading && <p role="status">Загружаем заявку…</p>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {data && <RequestCard request={data} onAccepted={() => void reload()} initiallyExpanded />}
    </PageLayout>
  );
}

export default function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequestContent id={id} />;
}
