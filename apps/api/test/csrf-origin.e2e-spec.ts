
import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import {
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';

import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createCsrfOriginMiddleware } from '../src/security/csrf-origin.middleware.js';

describe('CORE-03: защита источника запросов', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let createdUserId = '';

  const username =
    `csrf_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const registerUrl = '/api/v1/auth/register';

  const registration = {
    fullName: 'CSRF Test User',
    username,
    password: 'Strong-Test-Password-2026',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());

    app.use(
      createCsrfOriginMiddleware([
        'http://localhost:3001',
      ]),
    );

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdUserId && prisma) {
      await prisma.user.delete({
        where: {
          id: createdUserId,
        },
      });
    }

    if (app) {
      await app.close();
    }
  });

  it('отклоняет запрос с чужого Origin', async () => {
    const response = await request(app.getHttpServer())
      .post(registerUrl)
      .set('Origin', 'https://attacker.example')
      .send(registration)
      .expect(403);

    expect(response.body.statusCode).toBe(403);
  });

  it('не допускает обход через похожий адрес', async () => {
    await request(app.getHttpServer())
      .post(registerUrl)
      .set('Origin', 'http://localhost:3001.attacker.example')
      .send(registration)
      .expect(403);
  });

  it('отклоняет запрос с чужим Referer', async () => {
    await request(app.getHttpServer())
      .post(registerUrl)
      .set('Referer', 'https://attacker.example/form')
      .send(registration)
      .expect(403);
  });

  it('отклоняет cross-site запрос без Origin', async () => {
    await request(app.getHttpServer())
      .post(registerUrl)
      .set('Sec-Fetch-Site', 'cross-site')
      .send(registration)
      .expect(403);
  });

  it('пропускает запрос доверенного frontend', async () => {
    const response = await request(app.getHttpServer())
      .post(registerUrl)
      .set('Origin', 'http://localhost:3001')
      .send(registration)
      .expect(201);

    createdUserId = response.body.user.id as string;

    expect(response.body.user.username).toBe(username);
    expect(response.body.user.status).toBe('PENDING');
  });

  it('не блокирует безопасные GET-запросы', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Origin', 'https://attacker.example')
      .expect(401);
  });
});
