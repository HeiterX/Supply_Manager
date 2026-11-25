
import 'dotenv/config';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module.js';
import { createCsrfOriginMiddleware } from './security/csrf-origin.middleware.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  // Доверяем только явно указанным прокси.
  const trustedProxies = process.env.TRUSTED_PROXY_CIDRS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (trustedProxies?.length) {
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', trustedProxies);
  }

  // Разрешённые адреса frontend.
  const allowedOrigins = (
    process.env.FRONTEND_ORIGIN ??
    'http://localhost:3001'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['Retry-After'],
  });

  app.use(cookieParser());

  // Дополнительная проверка источника
  // изменяющих HTTP-запросов.
  app.use(
    createCsrfOriginMiddleware(allowedOrigins),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
