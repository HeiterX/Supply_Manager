import 'dotenv/config';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Purchase requests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId = '';
  let purchaseRequestId = '';
  let authCookie = '';

  const username = `request_employee_${Date.now()}`;
  const password = 'Strong-Test-Password-2026';

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

    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Сотрудник для заявки',
        username,
        password,
        department: 'Механический участок',
        position: 'Механик',
      })
      .expect(201);

    userId = registerResponse.body.user.id as string;

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(200);

    const setCookie = loginResponse.headers['set-cookie'];
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

    if (!cookie) {
      throw new Error('Auth cookie was not returned');
    }

    authCookie = cookie;
  });

  afterAll(async () => {
    if (purchaseRequestId) {
      await prisma.purchaseRequest
        .delete({ where: { id: purchaseRequestId } })
        .catch(() => undefined);
    }

    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }

    await app.close();
  });

  it('creates a multi-item request and returns it in mine', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Cookie', authCookie)
      .send({
        title: 'Комплектующие для ремонта насоса',
        description: 'Необходимо для планового ремонта',
        priority: 'HIGH',
        requiredAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        notes: 'Просьба подобрать надёжные аналоги при отсутствии оригинала',
        items: [
          {
            name: 'Подшипник SKF 6205',
            partNumber: '6205-2RS',
            quantity: 4,
            unit: 'шт.',
          },
          {
            name: 'Манжета 35x52',
            quantity: 8,
            unit: 'шт.',
            notes: 'Маслостойкая',
          },
        ],
      })
      .expect(201);

    purchaseRequestId = createResponse.body.id as string;

    expect(createResponse.body.status).toBe('NEW');
    expect(createResponse.body.priority).toBe('HIGH');
    expect(createResponse.body.requester.id).toBe(userId);
    expect(createResponse.body.requester.passwordHash).toBeUndefined();
    expect(createResponse.body.items).toHaveLength(2);
    expect(createResponse.body.items[0].name).toBe('Подшипник SKF 6205');

    const mineResponse = await request(app.getHttpServer())
      .get('/api/v1/purchase-requests/mine')
      .set('Cookie', authCookie)
      .expect(200);

    expect(
      (mineResponse.body as Array<{ id: string }>).some(
        (item) => item.id === purchaseRequestId,
      ),
    ).toBe(true);
  });

  it('allows employee to open own request', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/purchase-requests/${purchaseRequestId}`)
      .set('Cookie', authCookie)
      .expect(200);

    expect(response.body.id).toBe(purchaseRequestId);
    expect(response.body.items).toHaveLength(2);
  });

  it('does not allow employee to read the company-wide request list', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/purchase-requests')
      .set('Cookie', authCookie)
      .expect(403);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/purchase-requests/mine')
      .expect(401);
  });
});
