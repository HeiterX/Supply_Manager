import 'dotenv/config';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

describe('Tasks RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let procurement: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let employee: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  const taskIds: string[] = [];
  let publicRequestId = '';

  const tasksUrl = '/api/v1/tasks';
  const missingId = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

    procurement = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    admin = await createAuthenticatedAgent(app, prisma, 'ADMIN');
    employee = await createAuthenticatedAgent(app, prisma, 'EMPLOYEE');
  });

  afterAll(async () => {
    for (const id of taskIds) {
      await prisma.task.deleteMany({ where: { id } });
    }
    if (publicRequestId) {
      await prisma.purchaseRequest.deleteMany({
        where: { id: publicRequestId },
      });
    }
    for (const id of [procurement?.userId, admin?.userId, employee?.userId]) {
      if (id) await prisma.user.deleteMany({ where: { id } });
    }
    if (app) await app.close();
  });

  it('returns 401 for anonymous reads and writes across tasks routes', async () => {
    const anonymous = () => request(app.getHttpServer());

    await anonymous().get(tasksUrl).expect(401);
    await anonymous().get(`${tasksUrl}/items/registry`).expect(401);
    await anonymous().get(`${tasksUrl}/${missingId}`).expect(401);
    await anonymous().post(tasksUrl)
      .send({ title: 'Unauthenticated create' }).expect(401);
    await anonymous().post(`${tasksUrl}/${missingId}/items`)
      .send({ name: 'Test part', quantity: 1, unit: 'шт.' }).expect(401);
    await anonymous().patch(`${tasksUrl}/${missingId}`)
      .send({ priority: 'URGENT' }).expect(401);
    await anonymous().delete(`${tasksUrl}/${missingId}/items/${missingId}`)
      .expect(401);
    await anonymous().patch(`${tasksUrl}/${missingId}/orders/close`)
      .expect(401);
  });

  it('returns 403 for EMPLOYEE role on reads and writes', async () => {
    await employee.client.get(tasksUrl).expect(403);
    await employee.client.get(`${tasksUrl}/items/registry`).expect(403);
    await employee.client.get(`${tasksUrl}/${missingId}`).expect(403);
    await employee.client.post(tasksUrl)
      .send({ title: 'Employee create attempt' }).expect(403);
    await employee.client.post(`${tasksUrl}/${missingId}/supplier-offers`)
      .send({ supplierName: 'Employee supplier' }).expect(403);
    await employee.client.patch(`${tasksUrl}/${missingId}/orders/close`)
      .expect(403);
  });

  it('permits PROCUREMENT and ADMIN to read and write tasks', async () => {
    await procurement.client.get(tasksUrl).expect(200);
    await procurement.client.get(`${tasksUrl}/items/registry`).expect(200);

    const created = await procurement.client.post(tasksUrl)
      .send({ title: 'E2E RBAC procurement purchase' }).expect(201);
    const taskId = created.body.id as string;
    taskIds.push(taskId);

    await procurement.client.get(`${tasksUrl}/${taskId}`).expect(200);
    await admin.client.get(tasksUrl).expect(200);
    await admin.client.get(`${tasksUrl}/${taskId}`).expect(200);
    await admin.client.patch(`${tasksUrl}/${taskId}`)
      .send({ priority: 'HIGH' }).expect(200);
  });

  it('keeps the public purchase-request submission accessible', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests/public')
      .send({
        requesterName: 'E2E Public Requester',
        items: [{ name: 'Фильтр тестовый', quantity: 2, unit: 'шт.' }],
      })
      .expect(201);

    publicRequestId = created.body.id as string;
    expect(publicRequestId).toBeTruthy();
  });
});
