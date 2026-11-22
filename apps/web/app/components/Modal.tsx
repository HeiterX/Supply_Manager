'use client';

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './ui';

function containTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]',
  )].filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible');
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || document.activeElement === (event.shiftKey ? first : last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}

export function Modal({ title, onClose, children, description, busy = false, className = '' }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  description?: string;
  busy?: boolean;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

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

  return <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    className={`ui-dialog ${className}`}
    onKeyDown={containTab} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="ui-dialog-heading">
      <h2 id={titleId}>{title}</h2>
      <Button variant="ghost" icon aria-label="Закрыть" disabled={busy} onClick={onClose}>×</Button>
    </div>
    {description && <p id={descriptionId} className="mb-3 text-sm text-muted">{description}</p>}
    {children}
  </dialog>;
}

export function ModalActions({ busy, onCancel, submitLabel, danger = false, disabled = false }: {
  busy: boolean;
  onCancel: () => void;
  submitLabel: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
    <Button variant="outline" disabled={busy} onClick={onCancel}>Отмена</Button>
    <Button type="submit" variant={danger ? 'destructive' : 'primary'} loading={busy} disabled={disabled}>
      {busy ? 'Сохраняем…' : submitLabel}
    </Button>
  </div>;
}
