import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { AUTH_COOKIE_NAME } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[AUTH_COOKIE_NAME] as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Необходима авторизация');
    }

    const user = await this.authService.getUserFromToken(token);
    (request as AuthenticatedRequest).authUser = user;

    return true;
  }
}
