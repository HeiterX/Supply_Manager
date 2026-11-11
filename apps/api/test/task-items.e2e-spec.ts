import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

describe('Task items (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let client: ReturnType<typeof request.agent>;
  let authUserId = '';
  let taskId: string | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
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
    const auth = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    client = auth.client;
    authUserId = auth.userId;
  });

  afterAll(async () => {
    if (taskId) {
      await prisma.task.deleteMany({
        where: { id: taskId },
      });
    }

    if (app) {
      if (authUserId) {
      await prisma.user.deleteMany({ where: { id: authUserId } });
    }

    await app.close();
    }
  });

  it('создаёт, изменяет и удаляет позиции закупки', async () => {
    const createTaskResponse = await client
      .post('/api/v1/tasks')
      .send({
        title: 'E2E: позиции закупки',
        description: 'Автоматическая проверка TaskItem',
      })
      .expect(201);

    taskId = createTaskResponse.body.id;

    const valveResponse = await client
      .post(`/api/v1/tasks/${taskId}/items`)
      .send({
        name: 'Регулирующий клапан',
        partNumber: 'GIF 2410128',
        quantity: 2,
        unit: 'шт.',
        notes: 'DN40 PN25',
        sortOrder: 0,
      })
      .expect(201);

    const valveId = valveResponse.body.id;

    expect(valveResponse.body.name).toBe('Регулирующий клапан');
    expect(valveResponse.body.partNumber).toBe('GIF 2410128');
    expect(Number(valveResponse.body.quantity)).toBe(2);
    expect(valveResponse.body.unit).toBe('шт.');

    const gasketResponse = await client
      .post(`/api/v1/tasks/${taskId}/items`)
      .send({
        name: 'Прокладка',
        partNumber: 'TEST-GASKET-001',
        quantity: 4,
        unit: 'шт.',
        sortOrder: 1,
      })
      .expect(201);

    const gasketId = gasketResponse.body.id;

    await client
      .post(`/api/v1/tasks/${taskId}/items`)
      .send({
        name: 'Масло',
        quantity: 20,
        unit: 'л',
        sortOrder: 2,
      })
      .expect(201);

    const itemsResponse = await client
      .get(`/api/v1/tasks/${taskId}/items`)
      .expect(200);

    expect(itemsResponse.body).toHaveLength(3);
    expect(itemsResponse.body.map((item: { name: string }) => item.name)).toEqual([
      'Регулирующий клапан',
      'Прокладка',
      'Масло',
    ]);

    const taskResponse = await client
      .get(`/api/v1/tasks/${taskId}`)
      .expect(200);

    expect(taskResponse.body.items).toHaveLength(3);

    const updateResponse = await client
      .patch(`/api/v1/tasks/${taskId}/items/${valveId}`)
      .send({
        quantity: 3,
        notes: 'Количество изменено автоматическим E2E-тестом',
      })
      .expect(200);

    expect(Number(updateResponse.body.quantity)).toBe(3);
    expect(updateResponse.body.notes).toBe(
      'Количество изменено автоматическим E2E-тестом',
    );

    await client
      .delete(`/api/v1/tasks/${taskId}/items/${gasketId}`)
      .expect(200);

    const afterDeleteResponse = await client
      .get(`/api/v1/tasks/${taskId}`)
      .expect(200);

    expect(afterDeleteResponse.body.items).toHaveLength(2);
    expect(
      afterDeleteResponse.body.items.some(
        (item: { id: string }) => item.id === gasketId,
      ),
    ).toBe(false);

    expect(
      afterDeleteResponse.body.activities.some(
        (activity: { text: string }) =>
          activity.text.includes('Регулирующий клапан'),
      ),
    ).toBe(true);
  });

  it('отклоняет некорректные позиции', async () => {
    if (!taskId) {
      throw new Error('Тестовая задача не была создана');
    }

    await client
      .post(`/api/v1/tasks/${taskId}/items`)
      .send({
        name: '',
        quantity: 1,
        unit: 'шт.',
      })
      .expect(400);

    await client
      .post(`/api/v1/tasks/${taskId}/items`)
      .send({
        name: 'Некорректное количество',
        quantity: -5,
        unit: 'шт.',
      })
      .expect(400);

    await client
      .post(`/api/v1/tasks/${taskId}/items`)
      .send({
        name: 'Позиция без единицы измерения',
        quantity: 1,
        unit: '',
      })
      .expect(400);
  });
});
