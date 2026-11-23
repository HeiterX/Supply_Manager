
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import type { Request, Response } from 'express';

import { createCsrfToken } from '../security/csrf-token.js';

import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_TTL_SECONDS,
} from './auth.constants.js';

import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  // Регистрация нового сотрудника
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // Авторизация пользователя
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto);

    response.cookie(
      AUTH_COOKIE_NAME,
      result.accessToken,
      {
        ...cookieOptions(),
        maxAge: AUTH_TOKEN_TTL_SECONDS * 1000,
      },
    );

    return {
      user: result.user,
    };
  }

  // Получение текущего пользователя
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: Request) {
    return (request as AuthenticatedRequest).authUser;
  }

  // Получение CSRF-токена текущей сессии
  @Get('csrf')
  @UseGuards(JwtAuthGuard)
  csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const sessionToken = request.cookies?.[
      AUTH_COOKIE_NAME
    ] as string | undefined;

    if (!sessionToken) {
      throw new UnauthorizedException(
        'Необходима авторизация',
      );
    }

    response.setHeader(
      'Cache-Control',
      'no-store',
    );

    return {
      csrfToken: createCsrfToken(sessionToken),
    };
  }

  // Выход из системы
  @Post('logout')
  @HttpCode(204)
  logout(
    @Res({ passthrough: true }) response: Response,
  ) {
    response.clearCookie(
      AUTH_COOKIE_NAME,
      cookieOptions(),
    );
  }
}
