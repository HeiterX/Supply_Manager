'use client';

import Link from 'next/link';
import { ApiError } from '@/lib/api-error';
import { useRetryDelay } from '@/lib/use-retry-delay';
import { Alert, Button } from './ui';

export default function LoadError({ message, retry, retryLabel = 'Повторить', back }: {
  message: string | ApiError; retry: () => void; retryLabel?: string; back?: string;
}) {
  const error = message instanceof ApiError ? message : null;
  const waiting = useRetryDelay(error?.retryAt);
  const canRetry = !error || ![401, 403, 404].includes(error.status);
  return <Alert tone="danger">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>{error?.message ?? String(message)}</span>
      {canRetry ? <Button variant="outline" disabled={waiting} onClick={retry}>{retryLabel}</Button>
        : back && <Link href={back} className="ui-button ui-button--outline">Вернуться к списку</Link>}
    </div>
  </Alert>;
}
