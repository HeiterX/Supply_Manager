'use client';

import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';

export function Dialog({ title, trigger, children, className }: {
  title: string;
  trigger: (open: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const close = () => setIsOpen(false);

  return <>
    {trigger(() => setIsOpen(true))}
    {isOpen && <Modal title={title} onClose={close} className={className}>{children(close)}</Modal>}
  </>;
}
