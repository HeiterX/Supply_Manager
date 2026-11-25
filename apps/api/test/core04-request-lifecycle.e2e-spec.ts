import 'dotenv/config';

import {
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

type TestAgent = Awaited<
  ReturnType<typeof createAuthenticatedAgent>
>;

describe('CORE-04: Purchase request lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let employee: TestAgent;
  let otherEmployee: TestAgent;
  let procurement: TestAgent;

  let requestId = '';
  const requestIds: string[] = [];

  const api = '/api/v1/purchase-requests';

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
      app, prisma, 'EMPLOYEE',
    );

    otherEmployee = await createAuthenticatedAgent(
      app, prisma, 'EMPLOYEE',
    );

    procurement = await createAuthenticatedAgent(
      app, prisma, 'PROCUREMENT',
    );
  });

  afterAll(async () => {
    if (prisma) {
      if (requestIds.length > 0) {
        const requests = await prisma.purchaseRequest.findMany({
          where: { id: { in: requestIds } },
          select: { taskId: true },
        });

        const taskIds = requests
          .map((item) => item.taskId)
          .filter((id): id is string => id !== null);

        await prisma.purchaseRequest.deleteMany({
          where: { id: { in: requestIds } },
        });

        if (taskIds.length > 0) {
          await prisma.task.deleteMany({
            where: { id: { in: taskIds } },
          });
        }
      }

      for (const user of [
        employee,
        otherEmployee,
        procurement,
      ]) {
        if (user?.userId) {
          await prisma.user.deleteMany({
            where: { id: user.userId },
          });
        }
      }
    }

    if (app) await app.close();
  });

  async function createRequest(title: string) {
    const response = await employee.client
      .post(api)
      .send({
        title,
        priority: 'HIGH',
        requiredAt: new Date(
          Date.now() + 7 * 86400000,
        ).toISOString(),
        items: [
          {
            name: 'Подшипник 6205',
            quantity: 4,
            unit: 'шт.',
          },
          {
            name: 'Манжета насоса',
            quantity: 2,
            unit: 'шт.',
          },
        ],
      })
      .expect(201);

    const id = response.body.id as string;
    requestIds.push(id);
    return response;
  }

  it('создаёт заявку с несколькими позициями', async () => {
    const response = await createRequest(
      'CORE-04 Проверка заявки',
    );

    requestId = response.body.id as string;

    expect(response.body.status).toBe('NEW');
    expect(response.body.items).toHaveLength(2);
    expect(response.body.priority).toBe('HIGH');
    expect(response.body.requester.id).toBe(employee.userId);
  });

  it('сотрудник не видит чужую заявку', async () => {
    await employee.client
      .get(`${api}/${requestId}`)
      .expect(200);

    await otherEmployee.client
      .get(`${api}/${requestId}`)
      .expect(403);

    await procurement.client
      .get(`${api}/${requestId}`)
      .expect(200);
  });

  it('сотрудник не может принять заявку', async () => {
    await employee.client
      .patch(`${api}/${requestId}/accept`)
      .expect(403);

    const saved = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    expect(saved.taskId).toBeNull();
  });

  it('принятие создаёт закупку с исходными позициями', async () => {
    const response = await procurement.client
      .patch(`${api}/${requestId}/accept`)
      .expect(200);

    expect(response.body.status).toBe('CONVERTED');

    const taskId = response.body.task.id as string;

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        items: true,
        sourceRequest: true,
      },
    });

    expect(task.items).toHaveLength(2);
    expect(task.sourceRequest?.id).toBe(requestId);

    const names = task.items.map((item) => item.name);
    expect(names).toContain('Подшипник 6205');
    expect(names).toContain('Манжета насоса');
  });

  it('повторное принятие не создаёт вторую закупку', async () => {
    const request = await createRequest(
      'CORE-04 Повторное принятие',
    );
    const id = request.body.id as string;

    const responses = await Promise.all([
      procurement.client.patch(`${api}/${id}/accept`),
      procurement.client.patch(`${api}/${id}/accept`),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);

    const firstTaskId = responses[0].body.task.id as string;
    const secondTaskId = responses[1].body.task.id as string;

    expect(firstTaskId).toBe(secondTaskId);

    const saved = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
    });

    expect(saved.taskId).toBe(firstTaskId);
  });
});
