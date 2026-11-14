import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

// Simple per-process safeguard for the MVP. Use a shared store and an edge
// rate limiter before deploying behind multiple instances or a public proxy.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CLIENTS = 5000;

@Injectable()
export class PublicRequestRateLimitGuard implements CanActivate {
  private readonly counters = new Map<
    string,
    { count: number; resetAt: number }
  >();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    const isSubmission = request.path.replace(/\/$/, '').endsWith(
      '/purchase-requests/public',
    );
    const limit = isSubmission ? 10 : 60;
    // Express's request.ip uses the socket address while trust proxy is off.
    // Do not trust attacker-controlled X-Forwarded-For by default.
    const key = (isSubmission ? 'create:' : 'photo:') +
      (request.ip || request.socket.remoteAddress || 'unknown');

    let current = this.counters.get(key);
    if (!current || now >= current.resetAt) {
      // Keep memory bounded under an attack using many different IPs.
      if (this.counters.size >= MAX_CLIENTS) {
        for (const [candidate, bucket] of this.counters) {
          if (now >= bucket.resetAt) this.counters.delete(candidate);
        }
        if (this.counters.size >= MAX_CLIENTS && !this.counters.has(key)) {
          throw new HttpException(
            'Слишком много запросов. Повторите попытку позже',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
      current = { count: 0, resetAt: now + WINDOW_MS };
      this.counters.set(key, current);
    }

    if (current.count >= limit) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))),
      );
      throw new HttpException(
        'Превышен лимит запросов. Повторите попытку позже',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    current.count += 1;
    return true;
  }
}
