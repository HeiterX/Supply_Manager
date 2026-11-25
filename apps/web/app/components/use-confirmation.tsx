'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './ui';

export function useConfirmation() {
  const [request, setRequest] = useState<{ message: string; label: string; danger: boolean } | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => () => {
    pending.current?.(false);
    pending.current = null;
  }, []);

  function confirm(message: string, label = 'Подтвердить', danger = false) {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setRequest({ message, label, danger });
    });
  }

  function finish(confirmed: boolean) {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }

  const confirmation = request && <Modal title="Подтвердите действие" description={request.message} onClose={() => finish(false)}>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <Button data-initial-focus variant="outline" onClick={() => finish(false)}>Отмена</Button>
      <Button variant={request.danger ? 'destructive' : 'primary'} onClick={() => finish(true)}>{request.label}</Button>
    </div>
  </Modal>;

  return { confirm, confirmation };
}
