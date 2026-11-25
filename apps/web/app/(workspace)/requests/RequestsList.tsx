'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSession } from '@/app/components/AuthGate';
import PageLayout from '@/app/components/PageLayout';
import { Button, Card, EmptyState, Skeleton } from '@/app/components/ui';
import LoadError from '@/app/components/LoadError';
import { DiscoveryControls, Pagination } from '@/app/components/DiscoveryControls';
import { useDiscoveryList } from '@/lib/discovery';
import RequestCard, { type PurchaseRequest } from './RequestCard';

function RequestsContent() {
  const { user } = useSession();
  const employee = user.role === 'EMPLOYEE';
  const list = useDiscoveryList<PurchaseRequest>('requests');
  const { data, loading, error } = list;
  return (
    <PageLayout title={employee ? 'Мои заявки' : 'Входящие заявки'}
      action={<>
        {employee && <Link href="/request" className="ui-button ui-button--primary">Подать заявку</Link>}
        <Button variant="outline" onClick={() => void list.reload()}>Обновить</Button>
      </>}>
      <Card>
        <DiscoveryControls entity="requests" {...list} total={data?.total} />
      </Card>
      {loading && <Skeleton label="Загружаем заявки" />}
      {error && <LoadError message={error} retry={() => void list.reload()} />}
      {data?.items.length === 0 && <EmptyState title="Заявок не найдено" />}
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
    </PageLayout>
  );
}

export default function RequestsList() {
  return <Suspense fallback={<Skeleton label="Загружаем заявки" />}><RequestsContent /></Suspense>;
}
