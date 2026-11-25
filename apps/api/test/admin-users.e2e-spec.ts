
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
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

type TestAgent = Awaited<
  ReturnType<typeof createAuthenticatedAgent>
>;

describe('CORE-03: Admin Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let admin: TestAgent;
  let employee: TestAgent;
  let procurement: TestAgent;

  let pendingUserId = '';

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

    admin = await createAuthenticatedAgent(
      app,
      prisma,
      'ADMIN',
    );

    employee = await createAuthenticatedAgent(
      app,
      prisma,
      'EMPLOYEE',
    );

    procurement = await createAuthenticatedAgent(
      app,
      prisma,
      'PROCUREMENT',
    );
  });

  afterAll(async () => {
    if (prisma) {
      const userIds = [
        admin?.userId,
        employee?.userId,
        procurement?.userId,
        pendingUserId,
      ].filter((id): id is string => Boolean(id));

      if (userIds.length > 0) {
        await prisma.securityAuditEvent.deleteMany({
          where: {
            OR: [
              { actorId: { in: userIds } },
              { targetUserId: { in: userIds } },
            ],
          },
        });

        await prisma.user.deleteMany({
          where: {
            id: { in: userIds },
          },
        });
      }
    }

    if (app) {
      await app.close();
    }
  });

  it('возвращает 401 без авторизации', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${randomUUID()}/activate`)
      .expect(401);
  });

  it('запрещает доступ EMPLOYEE и PROCUREMENT', async () => {
    await employee.client
      .get('/api/v1/admin/users')
      .expect(403);

    await procurement.client
      .get('/api/v1/admin/users')
      .expect(403);
  });

  it('разрешает ADMIN просматривать пользователей', async () => {
    const response = await admin.client
      .get('/api/v1/admin/users')
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    const currentAdmin = response.body.find(
      (user: { id: string }) => user.id === admin.userId,
    );

    expect(currentAdmin).toBeDefined();
    expect(currentAdmin.role).toBe('ADMIN');
    expect(currentAdmin.passwordHash).toBeUndefined();
  });

  it('активирует PENDING и записывает аудит', async () => {
    const username = `core03_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'CORE03 Test Employee',
        username,
        password: 'Strong-Test-Password-2026',
      })
      .expect(201);

    pendingUserId = registered.body.user.id as string;

    expect(registered.body.user.status).toBe('PENDING');

    await employee.client
      .patch(`/api/v1/admin/users/${pendingUserId}/activate`)
      .expect(403);

    await procurement.client
      .patch(`/api/v1/admin/users/${pendingUserId}/activate`)
      .expect(403);

    const response = await admin.client
      .patch(`/api/v1/admin/users/${pendingUserId}/activate`)
      .expect(200);

    expect(response.body.status).toBe('ACTIVE');
    expect(response.body.passwordHash).toBeUndefined();

    const audit = await prisma.securityAuditEvent.findFirst({
      where: {
        actorId: admin.userId,
        targetUserId: pendingUserId,
        action: 'USER_ACTIVATED',
      },
    });

    expect(audit).not.toBeNull();
  });

  it('запрещает повторную активацию', async () => {
    await admin.client
      .patch(`/api/v1/admin/users/${pendingUserId}/activate`)
      .expect(409);
  });

  it('возвращает 404 для отсутствующего пользователя', async () => {
    await admin.client
      .patch(`/api/v1/admin/users/${randomUUID()}/activate`)
      .expect(404);
  });

  it('проверяет формат ID пользователя', async () => {
    await admin.client
      .patch('/api/v1/admin/users/invalid-id/activate')
      .expect(400);
  });
});
