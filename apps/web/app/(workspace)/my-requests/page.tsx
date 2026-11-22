'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { apiError, apiProblem, type ApiError } from '@/lib/api-error';
import { workingDate } from '@/lib/working-list';
import { useAbortableLoad } from '@/lib/use-abortable-load';
import LoadError from '@/app/components/LoadError';
import PageLayout from '@/app/components/PageLayout';
import { StatusBadge } from '@/app/components/StatusBadge';
import { Card, EmptyState, Skeleton } from '@/app/components/ui';

type RequestSummary = {
  id: string;
  number: number;
  title: string;
  status: string;
  createdAt: string;
};

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<RequestSummary[]>();
  const [error, setError] = useState<string | ApiError>('');
  const load = useCallback(async (signal: AbortSignal) => {
    setError('');
    try {
      const response = await apiFetch('/purchase-requests/mine', { signal });
      if (!response.ok) throw await apiError(response, 'Не удалось загрузить ваши заявки.');
      const data: RequestSummary[] = await response.json();
      if (!signal.aborted) setRequests(data);
    } catch (error) {
      if (!signal.aborted) setError(apiProblem(error, 'Не удалось загрузить ваши заявки.'));
    }
  }, []);
  const reload = useAbortableLoad(load);

  return <PageLayout title="Мои заявки" subtitle="Статусы заявок, привязанных к вашей учётной записи"
    action={<Link href="/request" className="ui-button ui-button--primary">Подать заявку</Link>}>
    {error ? <LoadError message={error} retry={() => void reload()} /> : !requests ? <Skeleton /> :
      requests.length ? <Card>
        <ul className="divide-y divide-slate-200">
          {requests.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <h2 className="font-semibold">№ {request.number} · {request.title}</h2>
              <p className="mt-1 text-sm text-muted">{workingDate(request.createdAt)}</p>
            </div>
            <StatusBadge status={request.status} kind="request" />
          </li>)}
        </ul>
      </Card> : <EmptyState title="За вашей учётной записью пока нет заявок"
        description="Заявки из публичной формы регистрируются по имени заявителя." />}
  </PageLayout>;
}
