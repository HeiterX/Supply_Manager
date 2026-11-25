import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import {
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
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

type AuthAgent = Awaited<
  ReturnType<typeof createAuthenticatedAgent>
>;

describe('CORE-04: review, rejection and history', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let employee: AuthAgent;
  let procurement: AuthAgent;
  let anotherProcurement: AuthAgent;

  let reviewRequestId = '';
  const createdRequestIds: string[] = [];

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
      app,
      prisma,
      'EMPLOYEE',
    );

    procurement = await createAuthenticatedAgent(
      app,
      prisma,
      'PROCUREMENT',
    );

    anotherProcurement = await createAuthenticatedAgent(
      app,
      prisma,
      'PROCUREMENT',
    );
  });

  afterAll(async () => {
    if (prisma) {
      const requests = await prisma.purchaseRequest.findMany({
        where: {
          id: { in: createdRequestIds },
        },
        select: { taskId: true },
      });

      const taskIds = requests
        .map((item) => item.taskId)
        .filter((id): id is string => id !== null);

      await prisma.purchaseRequest.deleteMany({
        where: {
          id: { in: createdRequestIds },
        },
      });

      if (taskIds.length > 0) {
        await prisma.task.deleteMany({
          where: {
            id: { in: taskIds },
          },
        });
      }

      for (const agent of [
        employee,
        procurement,
        anotherProcurement,
      ]) {
        if (agent?.userId) {
          await prisma.user.deleteMany({
            where: { id: agent.userId },
          });
        }
      }
    }

    if (app) {
      await app.close();
    }
  });

  async function createRequest() {
    const response = await employee.client
      .post(api)
      .send({
        title: `CORE-04 ${randomUUID()}`,
        priority: 'HIGH',
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
    createdRequestIds.push(id);

    return response;
  }

  it('сохраняет создание заявки в истории', async () => {
    const response = await createRequest();
    reviewRequestId = response.body.id as string;

    expect(response.body.status).toBe('NEW');

    expect(response.body.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'CREATED',
          toStatus: 'NEW',
          actorId: employee.userId,
        }),
      ]),
    );
  });

  it('не разрешает сотруднику менять статус', async () => {
    await employee.client
      .patch(`${api}/${reviewRequestId}/review`)
      .expect(403);

    await employee.client
      .patch(`${api}/${reviewRequestId}/reject`)
      .send({
        reason: 'Некорректная спецификация',
      })
      .expect(403);
  });

  it('снабженец берёт заявку на рассмотрение', async () => {
    const response = await procurement.client
      .patch(`${api}/${reviewRequestId}/review`)
      .expect(200);

    expect(response.body.status).toBe('IN_REVIEW');
    expect(response.body.assignedToId).toBe(
      procurement.userId,
    );
    expect(response.body.assignedTo.id).toBe(
      procurement.userId,
    );

    expect(response.body.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'START_REVIEW',
          fromStatus: 'NEW',
          toStatus: 'IN_REVIEW',
          actorId: procurement.userId,
        }),
      ]),
    );
  });

  it('повторное рассмотрение не дублирует историю', async () => {
    const response = await procurement.client
      .patch(`${api}/${reviewRequestId}/review`)
      .expect(200);

    const actions = (
      response.body.history as Array<{ action: string }>
    ).filter((entry) => entry.action === 'START_REVIEW');

    expect(actions).toHaveLength(1);
  });

  it('другой снабженец не перехватывает заявку', async () => {
    await anotherProcurement.client
      .patch(`${api}/${reviewRequestId}/review`)
      .expect(409);

    await anotherProcurement.client
      .patch(`${api}/${reviewRequestId}/reject`)
      .send({
        reason: 'Недостаточно данных',
      })
      .expect(409);

    await anotherProcurement.client
      .patch(`${api}/${reviewRequestId}/accept`)
      .expect(409);
  });

  it('отказ без корректной причины запрещён', async () => {
    await procurement.client
      .patch(`${api}/${reviewRequestId}/reject`)
      .send({})
      .expect(400);

    await procurement.client
      .patch(`${api}/${reviewRequestId}/reject`)
      .send({ reason: 'нет' })
      .expect(400);

    await procurement.client
      .patch(`${api}/${reviewRequestId}/reject`)
      .send({ reason: '     ' })
      .expect(400);

    const saved =
      await prisma.purchaseRequest.findUniqueOrThrow({
        where: { id: reviewRequestId },
      });

    expect(saved.status).toBe('IN_REVIEW');
  });

  it('сохраняет отказ, причину и исполнителя', async () => {
    const reason =
      'Не указаны обязательные технические характеристики';

    const response = await procurement.client
      .patch(`${api}/${reviewRequestId}/reject`)
      .send({ reason })
      .expect(200);

    expect(response.body.status).toBe('REJECTED');
    expect(response.body.decisionComment).toBe(reason);
    expect(response.body.processedById).toBe(
      procurement.userId,
    );

    expect(response.body.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'REJECTED',
          fromStatus: 'IN_REVIEW',
          toStatus: 'REJECTED',
          comment: reason,
          actorId: procurement.userId,
        }),
      ]),
    );

    const employeeView = await employee.client
      .get(`${api}/${reviewRequestId}`)
      .expect(200);

    expect(employeeView.body.decisionComment).toBe(
      reason,
    );
  });

  it('отклонённую заявку нельзя принять повторно', async () => {
    await procurement.client
      .patch(`${api}/${reviewRequestId}/accept`)
      .expect(409);

    await procurement.client
      .patch(`${api}/${reviewRequestId}/reject`)
      .send({
        reason: 'Повторный отказ без нового рассмотрения',
      })
      .expect(409);
  });

  it('при принятии сохраняет историю и ссылку на закупку', async () => {
    const created = await createRequest();
    const id = created.body.id as string;

    await procurement.client
      .patch(`${api}/${id}/review`)
      .expect(200);

    const accepted = await procurement.client
      .patch(`${api}/${id}/accept`)
      .expect(200);

    expect(accepted.body.status).toBe('CONVERTED');
    expect(accepted.body.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'ACCEPTED',
          fromStatus: 'IN_REVIEW',
          toStatus: 'CONVERTED',
        }),
      ]),
    );

    const taskId = accepted.body.task.id as string;

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        items: true,
        sourceRequest: true,
      },
    });

    expect(task.items).toHaveLength(2);
    expect(task.sourceRequest?.id).toBe(id);

    const repeated = await procurement.client
      .patch(`${api}/${id}/accept`)
      .expect(200);

    expect(repeated.body.task.id).toBe(taskId);

    const savedHistory =
      await prisma.purchaseRequestHistory.findMany({
        where: {
          requestId: id,
          action: 'ACCEPTED',
        },
      });

    expect(savedHistory).toHaveLength(1);
  });

  it('одновременное принятие и отклонение даёт одно решение', async () => {
    const created = await createRequest();
    const id = created.body.id as string;

    const [accepted, rejected] = await Promise.all([
      procurement.client.patch(`${api}/${id}/accept`),
      anotherProcurement.client
        .patch(`${api}/${id}/reject`)
        .send({
          reason: 'Недостаточно технических данных',
        }),
    ]);

    expect(
      [accepted.status, rejected.status].sort((a, b) => a - b),
    ).toEqual([200, 409]);

    const saved = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
      include: { history: true },
    });

    expect(
      ['CONVERTED', 'REJECTED'],
    ).toContain(saved.status);

    const finalActions = saved.history.filter(
      (entry) =>
        entry.action === 'ACCEPTED' ||
        entry.action === 'REJECTED',
    );

    expect(finalActions).toHaveLength(1);

    if (saved.status === 'CONVERTED') {
      expect(saved.taskId).not.toBeNull();
    } else {
      expect(saved.taskId).toBeNull();
    }
  });
});
