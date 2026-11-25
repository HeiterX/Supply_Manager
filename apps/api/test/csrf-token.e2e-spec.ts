import 'dotenv/config';

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

import {
  createCsrfToken,
  verifyCsrfToken,
} from '../src/security/csrf-token.js';

import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

type TestAgent = Awaited<
  ReturnType<typeof createAuthenticatedAgent>
>;

describe('CORE-03: CSRF tokens', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let employee: TestAgent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);

    employee = await createAuthenticatedAgent(
      app,
      prisma,
      'EMPLOYEE',
    );
  });

  afterAll(async () => {
    if (employee?.userId && prisma) {
      await prisma.user.deleteMany({
        where: {
          id: employee.userId,
        },
      });
    }

    if (app) {
      await app.close();
    }
  });

  it('запрещает выдачу токена гостю', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/csrf')
      .expect(401);
  });

  it('выдаёт токен авторизованному пользователю', async () => {
    const response = await employee.client
      .get('/api/v1/auth/csrf')
      .expect(200);

    expect(response.body.csrfToken).toMatch(
      /^[a-f0-9]{64}$/,
    );

    expect(
      response.headers['cache-control'],
    ).toContain('no-store');
  });

  it('возвращает одинаковый токен для одной сессии', async () => {
    const first = await employee.client
      .get('/api/v1/auth/csrf')
      .expect(200);

    const second = await employee.client
      .get('/api/v1/auth/csrf')
      .expect(200);

    expect(first.body.csrfToken).toBe(
      second.body.csrfToken,
    );
  });

  it('отклоняет поддельные токены', () => {
    const session = 'example-session-token';
    const validToken = createCsrfToken(session);

    expect(
      verifyCsrfToken(session, validToken),
    ).toBe(true);

    expect(
      verifyCsrfToken('another-session', validToken),
    ).toBe(false);

    expect(
      verifyCsrfToken(session, 'fake-token'),
    ).toBe(false);

    expect(
      verifyCsrfToken(session, undefined),
    ).toBe(false);
  });
});
