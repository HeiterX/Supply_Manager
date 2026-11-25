'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './ui';

export function useConfirmation() {
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => () => pending.current?.(false), []);

  function confirm(question: string) {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setMessage(question);
    });
  }

  function finish(confirmed: boolean) {
    const resolve = pending.current;
    pending.current = null;
    setMessage(null);
    resolve?.(confirmed);
  }

  const confirmation = message && <Modal title="Подтвердите действие" onClose={() => finish(false)}>
    <p className="text-sm text-muted">{message}</p>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <Button data-initial-focus variant="outline" onClick={() => finish(false)}>Отмена</Button>
      <Button onClick={() => finish(true)}>Подтвердить</Button>
    </div>
  </Modal>;

  return { confirm, confirmation };
}
