
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

describe('CORE-03: управление ролями пользователей', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let admin: TestAgent;
  let employee: TestAgent;
  let procurement: TestAgent;
  let target: TestAgent;

  const usersUrl = '/api/v1/admin/users';

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
      .patch(`${usersUrl}/${target.userId}/role`)
      .send({
        role: 'PROCUREMENT',
      })
      .expect(401);
  });

  it('возвращает 403 для EMPLOYEE и PROCUREMENT', async () => {
    await employee.client
      .patch(`${usersUrl}/${target.userId}/role`)
      .send({
        role: 'ADMIN',
      })
      .expect(403);

    await procurement.client
      .patch(`${usersUrl}/${target.userId}/role`)
      .send({
        role: 'ADMIN',
      })
      .expect(403);
  });

  it('проверяет UUID и существование пользователя', async () => {
    await admin.client
      .patch(`${usersUrl}/invalid-id/role`)
      .send({
        role: 'PROCUREMENT',
      })
      .expect(400);

    await admin.client
      .patch(`${usersUrl}/${randomUUID()}/role`)
      .send({
        role: 'PROCUREMENT',
      })
      .expect(404);
  });

  it('отклоняет некорректные данные', async () => {
    await admin.client
      .patch(`${usersUrl}/${target.userId}/role`)
      .send({
        role: 'SUPERADMIN',
      })
      .expect(400);

    await admin.client
      .patch(`${usersUrl}/${target.userId}/role`)
      .send({
        role: 'PROCUREMENT',
        extraPermission: true,
      })
      .expect(400);

    const user = await prisma.user.findUniqueOrThrow({
      where: {
        id: target.userId,
      },
    });

    expect(user.role).toBe('EMPLOYEE');
  });

  it('запрещает ADMIN менять собственную роль', async () => {
    await admin.client
      .patch(`${usersUrl}/${admin.userId}/role`)
      .send({
        role: 'EMPLOYEE',
      })
      .expect(403);

    const user = await prisma.user.findUniqueOrThrow({
      where: {
        id: admin.userId,
      },
    });

    expect(user.role).toBe('ADMIN');
    expect(user.status).toBe('ACTIVE');
  });

  it('отклоняет повторное назначение той же роли', async () => {
    await admin.client
      .patch(`${usersUrl}/${target.userId}/role`)
      .send({
        role: 'EMPLOYEE',
      })
      .expect(409);
  });

  it('меняет роль, записывает аудит и обновляет права', async () => {
    // Изначально EMPLOYEE не имеет доступа
    // к API закупок.
    await target.client
      .get('/api/v1/tasks')
      .expect(403);

    // ADMIN назначает роль PROCUREMENT.
    const response = await admin.client
      .patch(`${usersUrl}/${target.userId}/role`)
      .send({
        role: 'PROCUREMENT',
      })
      .expect(200);

    expect(response.body.id).toBe(target.userId);
    expect(response.body.role).toBe('PROCUREMENT');
    expect(response.body.passwordHash).toBeUndefined();

    // Проверяем реальные данные PostgreSQL.
    const updatedUser =
      await prisma.user.findUniqueOrThrow({
        where: {
          id: target.userId,
        },
      });

    expect(updatedUser.role).toBe('PROCUREMENT');

    // Проверяем запись в журнале аудита.
    const events = await prisma.securityAuditEvent.findMany({
      where: {
        actorId: admin.userId,
        targetUserId: target.userId,
        action:
          'USER_ROLE_CHANGED_EMPLOYEE_TO_PROCUREMENT',
      },
    });

    expect(events).toHaveLength(1);

    // Проверяем права в уже открытой сессии:
    // Guard должен прочитать новую роль из БД.
    await target.client
      .get('/api/v1/tasks')
      .expect(200);
  });
});
