'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Initial load and explicit reloads share cancellation and unmount cleanup. */
export function useAbortableLoad(load: (signal: AbortSignal) => Promise<void>) {
  const current = useRef<AbortController | null>(null);

  const reload = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    return load(controller.signal);
  }, [load]);

  useEffect(() => {
    void reload();
    return () => current.current?.abort();
  }, [reload]);

  return reload;
}
