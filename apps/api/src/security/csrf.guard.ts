import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { Request } from 'express';

import { AUTH_COOKIE_NAME } from '../auth/auth.constants.js';
import { AuthService } from '../auth/auth.service.js';
import { verifyCsrfToken } from './csrf-token.js';

const SAFE_METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

const PUBLIC_AUTH_PATHS = new Set([
  '/api/v1/auth/register',
  '/api/v1/auth/login',
]);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request>();

    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    if (PUBLIC_AUTH_PATHS.has(request.path)) {
      return true;
    }

    const session: unknown =
      request.cookies?.[AUTH_COOKIE_NAME];

    if (session === undefined || session === null) {
      return true;
    }

    if (typeof session !== 'string' || !session) {
      throw new ForbiddenException(
        'Недействительная cookie-сессия',
      );
    }

    const token = request.get('X-CSRF-Token');

    if (verifyCsrfToken(session, token)) {
      return true;
    }

    // Пользователь может удалить недействительную
    // сессию, даже если CSRF-токен недоступен.
    if (request.path === '/api/v1/auth/logout') {
      try {
        await this.authService.getUserFromToken(session);
      } catch {
        return true;
      }
    }

    throw new ForbiddenException(
      'CSRF-токен отсутствует или недействителен',
    );
  }
}
