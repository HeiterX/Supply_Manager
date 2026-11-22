'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Core09Error, errorMessage } from './core09-api';

type State<T> = { key: string; data?: T; error?: string; status: 'loading' | 'ready' | 'unavailable' | 'error' };

export function useCore09Resource<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, poll = false, enabled = true) {
  const [state, setState] = useState<State<T>>({ key, status: 'loading' });
  const reloadRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled) { reloadRef.current = () => {}; return; }
    let active = true;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let blocked = false;
    async function load() {
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const data = await loader(signal);
        if (active && !signal.aborted) setState({ key, data, status: 'ready' });
      } catch (error) {
        if (!active || signal.aborted) return;
        const status = error instanceof Core09Error ? error.status : 0;
        blocked = [401, 403, 404].includes(status);
        setState({ key, status: status === 404 ? 'unavailable' : 'error', error: errorMessage(error) });
      } finally {
        if (active && !signal.aborted && poll && !blocked) timer = setTimeout(() => {
          if (document.visibilityState === 'visible') void load();
        }, 60000);
      }
    }
    function onVisible() {
      if (!blocked && document.visibilityState === 'visible') void load();
    }
    reloadRef.current = () => { blocked = false; void load(); };
    void load();
    if (poll) document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      if (poll) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, loader, poll, enabled]);
  const refresh = useCallback(() => reloadRef.current(), []);
  return { ...(state.key === key ? state : { key, status: 'loading' as const }), refresh };
}
