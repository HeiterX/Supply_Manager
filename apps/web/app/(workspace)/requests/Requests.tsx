'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSession } from '@/app/components/AuthGate';
import PageLayout from '@/app/components/PageLayout';
import { Modal } from '@/app/components/Modal';
import { StatusBadge, requestStatusLabels } from '@/app/components/StatusBadge';
import { WorkingTable, WorkingTableControls } from '@/app/components/WorkingTable';
import { Button, Skeleton } from '@/app/components/ui';
import { priorityLabels, useWorkingList, workingDate, workingLink } from '@/lib/working-list';
import RequestDetails, { requester, type RequestRow } from './RequestDetails';

const statuses = Object.entries(requestStatusLabels).filter(([status]) => status !== 'ACCEPTED' && status !== 'IN_PROGRESS');

function Requests() {
  const list = useWorkingList<RequestRow>('requests');
  const { user } = useSession();
  const title = user.role === 'EMPLOYEE' ? 'Мои заявки' : 'Входящие заявки';
  const [selected, setSelected] = useState<RequestRow | null>(null);
  return <PageLayout title={title}
    subtitle={list.page ? `Заявок по текущему виду: ${list.page.total}` : undefined}
    action={<Link href="/request" className="ui-button ui-button--outline">Подать заявку</Link>}>
    <div className="min-w-0 space-y-4">
      <WorkingTableControls list={list} statuses={statuses} entity="requests" />
      <WorkingTable list={list} label={title} empty="Заявок по текущему виду нет"
        headers={['Заявка', 'Заявитель', 'Создана', 'Позиции', 'Приоритет', 'Статус', 'Действия']}>
        {list.page?.items.map((request) => <tr key={request.id} className="hover:bg-accent-soft/50">
          <th scope="row" className="min-w-52 text-left [overflow-wrap:anywhere]">
            <Link className="block text-accent hover:underline" href={workingLink(`/requests/${request.id}`, list.href)}>
              <span className="block text-xs text-muted">№{request.number}</span>{request.title}
            </Link>
          </th>
          <td data-label="Заявитель" className="min-w-32 [overflow-wrap:anywhere]">{requester(request)}</td>
          <td data-label="Создана" className="whitespace-nowrap">{workingDate(request.createdAt)}</td>
          <td data-label="Позиции">{request._count?.items ?? request.items?.length ?? '—'}</td>
          <td data-label="Приоритет">{priorityLabels[request.priority] ?? request.priority}</td>
          <td data-label="Статус"><StatusBadge status={request.status} kind="request" />
            {request.processedBy && <p className="mt-1 text-xs text-muted">{request.processedBy.fullName}</p>}</td>
          <td data-label="Действия"><Button variant="outline" onClick={() => setSelected(request)} aria-label={`Предпросмотр заявки №${request.number}`}>Предпросмотр</Button></td>
        </tr>)}
      </WorkingTable>
    </div>
    {selected && <Modal title={`Заявка №${selected.number}`} onClose={() => setSelected(null)}>
      <RequestDetails key={selected.id} id={selected.id} back={list.href} onChanged={list.reload} />
    </Modal>}
  </PageLayout>;
}

export default function RequestsPage() {
  return <Suspense fallback={<PageLayout title="Входящие заявки"><Skeleton /></PageLayout>}><Requests /></Suspense>;
}
