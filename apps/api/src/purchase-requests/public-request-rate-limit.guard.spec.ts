import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PublicRequestRateLimitGuard } from './public-request-rate-limit.guard.js';

function context(ip: string, path = '/api/v1/purchase-requests/public') {
  const setHeader = vi.fn();
  return {
    setHeader,
    value: {
      switchToHttp: () => ({
        getRequest: () => ({ path, ip, socket: {} }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext,
  };
}

describe('Public request limiter', () => {
  it('provides Retry-After when all 5000 buckets are occupied, then recovers after expiry', () => {
    const guard = new PublicRequestRateLimitGuard();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      for (let client = 0; client < 5000; client += 1) {
        expect(guard.canActivate(context(String(client)).value)).toBe(true);
      }
      const blocked = context('new-client');
      expect(() => guard.canActivate(blocked.value)).toThrow();
      expect(blocked.setHeader).toHaveBeenCalledWith('Retry-After', '600');
      now.mockReturnValue(601000);
      expect(guard.canActivate(blocked.value)).toBe(true);
    } finally {
      now.mockRestore();
    }
  });
});
