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

describe('CORE-03: CSRF enforcement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let client: ReturnType<typeof request.agent>;
  let userId = '';
  let taskId = '';

  const username =
    `csrf_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const password = 'Strong-Test-Password-2026';

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
    client = request.agent(app.getHttpServer());

    const registered = await client
      .post('/api/v1/auth/register')
      .send({
        fullName: 'CSRF E2E User',
        username,
        password,
      })
      .expect(201);

    userId = registered.body.user.id as string;

    await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'ACTIVE',
        role: 'PROCUREMENT',
      },
    });

    await client
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(200);
  });

  afterAll(async () => {
    if (prisma) {
      if (taskId) {
        await prisma.task.deleteMany({
          where: { id: taskId },
        });
      }
      if (userId) {
        await prisma.user.deleteMany({
          where: { id: userId },
        });
      }
    }
    if (app) {
      await app.close();
    }
  });

  it('отклоняет неавторизованный запрос', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .send({ title: 'Anonymous' })
      .expect(401);
  });

  it('отклоняет запрос без CSRF-токена', async () => {
    await client
      .post('/api/v1/tasks')
      .send({ title: 'Without CSRF' })
      .expect(403);
  });

  it('отклоняет поддельный токен', async () => {
    await client
      .post('/api/v1/tasks')
      .set('X-CSRF-Token', 'a'.repeat(64))
      .send({ title: 'Forged CSRF' })
      .expect(403);
  });

  it('принимает корректный токен', async () => {
    const csrf = await client
      .get('/api/v1/auth/csrf')
      .expect(200);

    const created = await client
      .post('/api/v1/tasks')
      .set(
        'X-CSRF-Token',
        csrf.body.csrfToken as string,
      )
      .send({ title: 'Valid CSRF' })
      .expect(201);

    taskId = created.body.id as string;
    expect(taskId).toBeTruthy();
  });

  it('оставляет публичную регистрацию доступной', async () => {
    const guestUsername =
      `guest_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const created = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Guest User',
        username: guestUsername,
        password,
      })
      .expect(201);

    await prisma.user.deleteMany({
      where: {
        id: created.body.user.id as string,
      },
    });
  });
});
