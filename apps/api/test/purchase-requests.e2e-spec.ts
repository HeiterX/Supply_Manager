import 'dotenv/config';

import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Purchase requests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId = '';
  let purchaseRequestId = '';
  let authCookie = '';
  let publicRequestId = '';
  let publicItemIds: string[] = [];
  let publicUploadToken = '';

  const samplePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X8m9RgAAAABJRU5ErkJggg==',
    'base64',
  );

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
    if (publicRequestId) {
      const items = await prisma.purchaseRequestItem.findMany({
        where: { requestId: publicRequestId },
        select: { photoPath: true },
      });
      await prisma.purchaseRequest.delete({ where: { id: publicRequestId } })
        .catch(() => undefined);
      for (const item of items) {
        if (item.photoPath) {
          await unlink(join(process.cwd(), 'uploads', 'purchase-requests', item.photoPath))
            .catch(() => undefined);
        }
      }
    }

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

  it('creates an anonymous request and returns a short-lived upload credential', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests/public')
      .send({
        requesterName: 'Тестовый работник',
        items: [
          { name: 'Манжета', quantity: 2, unit: 'шт.' },
          { name: 'Подшипник', quantity: 1, unit: 'шт.' },
        ],
      })
      .expect(201);

    publicRequestId = response.body.id as string;
    publicItemIds = (response.body.items as Array<{ id: string }>).map((item) => item.id);
    publicUploadToken = response.body.uploadToken as string;
    expect(publicUploadToken).toEqual(expect.any(String));
    expect(publicItemIds).toHaveLength(2);
  });

  it('rejects upload without a token and with an invalid token', async () => {
    const url = '/api/v1/purchase-requests/public/' + publicRequestId +
      '/items/' + publicItemIds[0] + '/photo';
    await request(app.getHttpServer())
      .post(url)
      .attach('photo', samplePng, { filename: 'photo.png', contentType: 'image/png' })
      .expect(401);
    await request(app.getHttpServer())
      .post(url)
      .set('X-Upload-Token', 'forged')
      .attach('photo', samplePng, { filename: 'photo.png', contentType: 'image/png' })
      .expect(401);
  });

  it('does not allow a token to access an item from another request', async () => {
    const foreignItem = await prisma.purchaseRequestItem.findFirstOrThrow({
      where: { requestId: purchaseRequestId },
      select: { id: true },
    });
    await request(app.getHttpServer())
      .post('/api/v1/purchase-requests/public/' + publicRequestId +
        '/items/' + foreignItem.id + '/photo')
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', samplePng, { filename: 'photo.png', contentType: 'image/png' })
      .expect(404);
  });

  it('rejects an expired, previously valid token', async () => {
    const nowAfterExpiry = Date.now() + 16 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(nowAfterExpiry);
    try {
      await request(app.getHttpServer())
        .post('/api/v1/purchase-requests/public/' + publicRequestId +
          '/items/' + publicItemIds[0] + '/photo')
        .set('X-Upload-Token', publicUploadToken)
        .attach('photo', samplePng, { filename: 'photo.png', contentType: 'image/png' })
        .expect(401);
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects a file falsely labelled as an image', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/purchase-requests/public/' + publicRequestId +
        '/items/' + publicItemIds[0] + '/photo')
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', Buffer.from('not a png file'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('uploads a real image once, blocks public reads and repeated replacement', async () => {
    const uploadUrl = '/api/v1/purchase-requests/public/' + publicRequestId +
      '/items/' + publicItemIds[0] + '/photo';
    await request(app.getHttpServer())
      .post(uploadUrl)
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', samplePng, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);

    await request(app.getHttpServer())
      .post(uploadUrl)
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', samplePng, { filename: 'replacement.png', contentType: 'image/png' })
      .expect(409);

    const readUrl = '/api/v1/purchase-requests/public/items/' + publicItemIds[0] + '/photo';
    await request(app.getHttpServer()).get(readUrl).expect(401);
    await request(app.getHttpServer()).get(readUrl)
      .set('Cookie', authCookie).expect(403);

    await prisma.user.update({
      where: { id: userId },
      data: { role: 'PROCUREMENT' },
    });
    const readResponse = await request(app.getHttpServer()).get(readUrl)
      .set('Cookie', authCookie)
      .expect(200);
    expect(readResponse.headers['content-type']).toMatch(/^image\/png/);
    expect(readResponse.headers['cache-control']).toBe('private, no-store');
    expect(readResponse.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects uploads after the request is taken into review', async () => {
    await prisma.purchaseRequest.update({
      where: { id: publicRequestId },
      data: { status: 'IN_REVIEW' },
    });
    try {
      await request(app.getHttpServer())
        .post('/api/v1/purchase-requests/public/' + publicRequestId +
          '/items/' + publicItemIds[1] + '/photo')
        .set('X-Upload-Token', publicUploadToken)
        .attach('photo', samplePng, { filename: 'photo.png', contentType: 'image/png' })
        .expect(403);
    } finally {
      await prisma.purchaseRequest.update({
        where: { id: publicRequestId },
        data: { status: 'NEW' },
      });
    }
  });

  it('rate limits abusive public submissions', async () => {
    let received429 = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/purchase-requests/public')
        .send({});
      if (response.status === 429) {
        received429 = true;
        expect(response.headers['retry-after']).toBeTruthy();
        break;
      }
      expect(response.status).toBe(400);
    }
    expect(received429).toBe(true);
  });

});
