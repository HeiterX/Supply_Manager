'use client';

import { useLayoutEffect, useState } from 'react';

export function useFocusAfterRender() {
  const [target, setTarget] = useState<(() => HTMLElement | null | undefined) | null>(null);
  useLayoutEffect(() => { target?.()?.focus(); }, [target]);
  return (find: () => HTMLElement | null | undefined) => setTarget(() => find);
}
