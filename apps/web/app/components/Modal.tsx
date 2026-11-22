'use client';

import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button } from './ui';

export function Modal({ title, onClose, children, busy = false, className = '' }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return <dialog ref={dialogRef} aria-labelledby={titleId} className={`ui-dialog ${className}`}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="ui-dialog-heading">
      <h2 id={titleId}>{title}</h2>
      <Button variant="ghost" icon aria-label="Закрыть" disabled={busy} onClick={onClose}>×</Button>
    </div>
    {children}
  </dialog>;
}

export function ModalActions({ busy, onCancel, submitLabel, danger = false }: {
  busy: boolean;
  onCancel: () => void;
  submitLabel: string;
  danger?: boolean;
}) {
  return <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
    <Button variant="outline" disabled={busy} onClick={onCancel}>Отмена</Button>
    <Button type="submit" variant={danger ? 'destructive' : 'primary'} loading={busy}>
      {busy ? 'Сохраняем…' : submitLabel}
    </Button>
  </div>;
}
