
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

describe('CORE-03: блокировка пользователей', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let admin: TestAgent;
  let employee: TestAgent;
  let procurement: TestAgent;
  let target: TestAgent;

  const url = '/api/v1/admin/users';

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

    target = await createAuthenticatedAgent(
      app,
      prisma,
      'EMPLOYEE',
    );
  });

  afterAll(async () => {
    if (prisma) {
      const ids = [
        admin?.userId,
        employee?.userId,
        procurement?.userId,
        target?.userId,
      ].filter((id): id is string => Boolean(id));

      if (ids.length > 0) {
        await prisma.securityAuditEvent.deleteMany({
          where: {
            OR: [
              { actorId: { in: ids } },
              { targetUserId: { in: ids } },
            ],
          },
        });

        await prisma.user.deleteMany({
          where: {
            id: { in: ids },
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
      .patch(`${url}/${target.userId}/block`)
      .expect(401);
  });

  it('возвращает 403 для EMPLOYEE и PROCUREMENT', async () => {
    await employee.client
      .patch(`${url}/${target.userId}/block`)
      .expect(403);

    await procurement.client
      .patch(`${url}/${target.userId}/block`)
      .expect(403);
  });

  it('запрещает администратору блокировать себя', async () => {
    await admin.client
      .patch(`${url}/${admin.userId}/block`)
      .expect(403);
  });

  it('возвращает 404 для неизвестного пользователя', async () => {
    await admin.client
      .patch(`${url}/${randomUUID()}/block`)
      .expect(404);
  });

  it('отклоняет некорректный UUID', async () => {
    await admin.client
      .patch(`${url}/invalid-id/block`)
      .expect(400);
  });

  it('блокирует сотрудника и записывает аудит', async () => {
    const response = await admin.client
      .patch(`${url}/${target.userId}/block`)
      .expect(200);

    expect(response.body.status).toBe('BLOCKED');
    expect(response.body.id).toBe(target.userId);
    expect(response.body.passwordHash).toBeUndefined();

    const events = await prisma.securityAuditEvent.findMany({
      where: {
        actorId: admin.userId,
        targetUserId: target.userId,
        action: 'USER_BLOCKED',
      },
    });

    expect(events).toHaveLength(1);
  });

  it('отзывает доступ заблокированного пользователя', async () => {
    await target.client
      .get('/api/v1/auth/me')
      .expect(401);
  });

  it('не допускает повторную блокировку', async () => {
    await admin.client
      .patch(`${url}/${target.userId}/block`)
      .expect(409);

    const eventCount = await prisma.securityAuditEvent.count({
      where: {
        actorId: admin.userId,
        targetUserId: target.userId,
        action: 'USER_BLOCKED',
      },
    });

    expect(eventCount).toBe(1);
  });
});
