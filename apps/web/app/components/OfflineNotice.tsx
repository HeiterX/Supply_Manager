'use client';

import { useSyncExternalStore } from 'react';
import { Alert } from './ui';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export default function OfflineNotice() {
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);
  return offline && <div className="offline-notice"><Alert tone="warning">
    Нет подключения к сети. Введённые данные остаются в открытой форме.
  </Alert></div>;
}
