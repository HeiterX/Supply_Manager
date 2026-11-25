'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import PageLayout from '@/app/components/PageLayout';
import { Skeleton } from '@/app/components/ui';
import { workingBack } from '@/lib/working-list';
import RequestDetails from '../RequestDetails';

function Details() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const path = workingBack(search.get('back'));
  const back = /^\/requests(?:\?|$)/.test(path) ? path : '/requests';
  return <PageLayout title="Карточка заявки" action={<Link href={back} className="ui-button ui-button--outline">К заявкам</Link>}>
    <RequestDetails key={id} id={id} back={back} />
  </PageLayout>;
}

export default function RequestPage() {
  return <Suspense fallback={<Skeleton />}><Details /></Suspense>;
}
