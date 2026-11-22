'use client';

import { useEffect, useState } from 'react';

export function useRetryDelay(retryAt: number | null | undefined) {
  const [expired, setExpired] = useState<number>();
  useEffect(() => {
    if (!retryAt) return;
    let timer: ReturnType<typeof setTimeout>;
    function schedule(deadline: number) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) setExpired(deadline);
      else timer = setTimeout(() => schedule(deadline), Math.min(remaining, 2_147_483_647));
    }
    schedule(retryAt);
    return () => clearTimeout(timer);
  }, [retryAt]);
  return Boolean(retryAt && retryAt !== expired);
}
