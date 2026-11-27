import 'dotenv/config';

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Purchase requests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId = '';
  let purchaseRequestId = '';
  let authCookie = '';
  let csrfToken = '';
  let publicRequestId = '';
  let publicItemIds: string[] = [];
  let publicUploadToken = '';

  let samplePng: Buffer;

  const username = `request_employee_${Date.now()}`;
  const password = 'Strong-Test-Password-2026';

  beforeAll(async () => {
    samplePng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: '#336699',
      },
    })
      .png()
      .toBuffer();
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

    const csrfResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/csrf')
      .set('Cookie', authCookie)
      .expect(200);

    csrfToken = csrfResponse.body.csrfToken as string;
  });

  afterAll(async () => {
    if (publicRequestId) {
      const items = await prisma.purchaseRequestItem.findMany({
        where: { requestId: publicRequestId },
        select: { photoPath: true },
      });
      await prisma.purchaseRequest
        .delete({ where: { id: publicRequestId } })
        .catch(() => undefined);
      for (const item of items) {
        if (item.photoPath) {
          await unlink(
            join(process.cwd(), 'uploads', 'purchase-requests', item.photoPath),
          ).catch(() => undefined);
        }
      }
    }

    if (purchaseRequestId) {
      await prisma.purchaseRequest
        .delete({ where: { id: purchaseRequestId } })
        .catch(() => undefined);
    }

    if (userId) {
      await prisma.user
        .delete({ where: { id: userId } })
        .catch(() => undefined);
    }

    await app.close();
  });

  it('creates a multi-item request and returns it in mine', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests')
      .set('Cookie', authCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        title: 'Комплектующие для ремонта насоса',
        description: 'Необходимо для планового ремонта',
        priority: 'HIGH',
        requiredAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
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
    const requiredAt = new Date(
      Date.now() + 7 * 86400000,
    ).toISOString();

    const response = await request(app.getHttpServer())
      .post('/api/v1/purchase-requests/public')
      .send({
        requesterName: 'Тестовый работник',
        priority: 'HIGH',
        requiredAt,
        items: [
          { name: 'Манжета', quantity: 2, unit: 'шт.' },
          { name: 'Подшипник', quantity: 1, unit: 'шт.' },
          { name: 'JPEG', quantity: 1, unit: 'шт.' },
          { name: 'WebP', quantity: 1, unit: 'шт.' },
          { name: 'Status race', quantity: 1, unit: 'шт.' },
        ],
      })
      .expect(201);

    expect(response.body.priority).toBe('HIGH');
    expect(
      new Date(response.body.requiredAt as string).toISOString(),
    ).toBe(requiredAt);

    publicRequestId = response.body.id as string;
    publicItemIds = (response.body.items as Array<{ id: string }>).map(
      (item) => item.id,
    );
    publicUploadToken = response.body.uploadToken as string;
    expect(publicUploadToken).toEqual(expect.any(String));
    expect(publicItemIds).toHaveLength(5);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects upload without a token and with an invalid token', async () => {
    const url =
      '/api/v1/purchase-requests/public/' +
      publicRequestId +
      '/items/' +
      publicItemIds[0] +
      '/photo';
    await request(app.getHttpServer())
      .post(url)
      .attach('photo', samplePng, {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(401);
    await request(app.getHttpServer())
      .post(url)
      .set('X-Upload-Token', 'forged')
      .attach('photo', samplePng, {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(401);
  });

  it('does not allow a token to access an item from another request', async () => {
    const foreignItem = await prisma.purchaseRequestItem.findFirstOrThrow({
      where: { requestId: purchaseRequestId },
      select: { id: true },
    });
    await request(app.getHttpServer())
      .post(
        '/api/v1/purchase-requests/public/' +
          publicRequestId +
          '/items/' +
          foreignItem.id +
          '/photo',
      )
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', samplePng, {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(404);
  });

  it('rejects an expired, previously valid token', async () => {
    const nowAfterExpiry = Date.now() + 16 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(nowAfterExpiry);
    try {
      await request(app.getHttpServer())
        .post(
          '/api/v1/purchase-requests/public/' +
            publicRequestId +
            '/items/' +
            publicItemIds[0] +
            '/photo',
        )
        .set('X-Upload-Token', publicUploadToken)
        .attach('photo', samplePng, {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .expect(401);
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects a file falsely labelled as an image', async () => {
    await request(app.getHttpServer())
      .post(
        '/api/v1/purchase-requests/public/' +
          publicRequestId +
          '/items/' +
          publicItemIds[0] +
          '/photo',
      )
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', Buffer.from('not a png file'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('rejects foreign request credentials, invalid MIME, corrupt images and oversized files', async () => {
    const url =
      '/api/v1/purchase-requests/public/' +
      publicRequestId +
      '/items/' +
      publicItemIds[1] +
      '/photo';
    await request(app.getHttpServer())
      .post(
        '/api/v1/purchase-requests/public/' +
          purchaseRequestId +
          '/items/' +
          publicItemIds[1] +
          '/photo',
      )
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', samplePng, 'photo.png')
      .expect(401);
    await request(app.getHttpServer())
      .post(url)
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', samplePng, {
        filename: 'photo.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    // Valid PNG headers/IEND but a corrupt IDAT stream (accepted by signature-only checks).
    const corrupt = Buffer.from(samplePng);
    const idat = corrupt.indexOf(Buffer.from('IDAT'));
    corrupt[idat + 5] ^= 0xff;
    await request(app.getHttpServer())
      .post(url)
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', corrupt, {
        filename: 'corrupt.png',
        contentType: 'image/png',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', Buffer.alloc(8 * 1024 * 1024 + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
    const item = await prisma.purchaseRequestItem.findUniqueOrThrow({
      where: { id: publicItemIds[1] },
    });
    expect(item.photoPath).toBeNull();
  });

  it('accepts actual JPEG and WebP images', async () => {
    for (const [index, format, mime] of [
      [2, 'jpeg', 'image/jpeg'],
      [3, 'webp', 'image/webp'],
    ] as const) {
      const image = await sharp(samplePng).toFormat(format).toBuffer();
      await request(app.getHttpServer())
        .post(
          '/api/v1/purchase-requests/public/' +
            publicRequestId +
            '/items/' +
            publicItemIds[index] +
            '/photo',
        )
        .set('X-Upload-Token', publicUploadToken)
        .attach('photo', image, {
          filename: 'photo.' + format,
          contentType: mime,
        })
        .expect(201);
    }
  });

  it('uploads a real image once, blocks public reads and repeated replacement', async () => {
    const uploadUrl =
      '/api/v1/purchase-requests/public/' +
      publicRequestId +
      '/items/' +
      publicItemIds[0] +
      '/photo';
    await request(app.getHttpServer())
      .post(uploadUrl)
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', samplePng, {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(201);

    if (process.platform !== 'win32') {
      const row = await prisma.purchaseRequestItem.findUniqueOrThrow({
        where: { id: publicItemIds[0] },
        select: { photoPath: true },
      });
      const photo = await stat(join(process.cwd(), 'uploads', 'purchase-requests', row.photoPath!));
      expect(photo.mode & 0o077).toBe(0);
    }

    await request(app.getHttpServer())
      .post(uploadUrl)
      .set('X-Upload-Token', publicUploadToken)
      .attach('photo', samplePng, {
        filename: 'replacement.png',
        contentType: 'image/png',
      })
      .expect(409);

    const readUrl =
      '/api/v1/purchase-requests/public/items/' + publicItemIds[0] + '/photo';
    await request(app.getHttpServer()).get(readUrl).expect(401);
    await request(app.getHttpServer())
      .get(readUrl)
      .set('Cookie', authCookie)
      .expect(403);

    await prisma.user.update({
      where: { id: userId },
      data: { role: 'PROCUREMENT' },
    });
    const readResponse = await request(app.getHttpServer())
      .get(readUrl)
      .set('Cookie', authCookie)
      .expect(200);
    expect(readResponse.headers['content-type']).toMatch(/^image\/png/);
    expect(readResponse.headers['cache-control']).toBe('private, no-store');
    expect(readResponse.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows ADMIN and only the EMPLOYEE owner; blocks stored path traversal', async () => {
    const readUrl =
      '/api/v1/purchase-requests/public/items/' + publicItemIds[0] + '/photo';
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'ADMIN' },
    });
    await request(app.getHttpServer())
      .get(readUrl)
      .set('Cookie', authCookie)
      .expect(200);
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'EMPLOYEE' },
    });
    await prisma.purchaseRequest.update({
      where: { id: publicRequestId },
      data: { requesterId: userId },
    });
    const item = await prisma.purchaseRequestItem.findUniqueOrThrow({
      where: { id: publicItemIds[0] },
    });
    try {
      await request(app.getHttpServer())
        .get(readUrl)
        .set('Cookie', authCookie)
        .expect(200);
      await prisma.purchaseRequestItem.update({
        where: { id: item.id },
        data: { photoPath: '../../.env' },
      });
      await request(app.getHttpServer())
        .get(readUrl)
        .set('Cookie', authCookie)
        .expect(404);
    } finally {
      await prisma.purchaseRequestItem.update({
        where: { id: item.id },
        data: { photoPath: item.photoPath },
      });
      await prisma.purchaseRequest.update({
        where: { id: publicRequestId },
        data: { requesterId: null },
      });
    }
    await request(app.getHttpServer())
      .get(readUrl)
      .set('Cookie', authCookie)
      .expect(403);
  });

  it('rejects uploads after the request is taken into review', async () => {
    await prisma.purchaseRequest.update({
      where: { id: publicRequestId },
      data: { status: 'IN_REVIEW' },
    });
    try {
      await request(app.getHttpServer())
        .post(
          '/api/v1/purchase-requests/public/' +
            publicRequestId +
            '/items/' +
            publicItemIds[1] +
            '/photo',
        )
        .set('X-Upload-Token', publicUploadToken)
        .attach('photo', samplePng, {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .expect(403);
    } finally {
      await prisma.purchaseRequest.update({
        where: { id: publicRequestId },
        data: { status: 'NEW' },
      });
    }
  });

  it('allows only one concurrent upload and cleans the losing file', async () => {
    const url =
      '/api/v1/purchase-requests/public/' +
      publicRequestId +
      '/items/' +
      publicItemIds[1] +
      '/photo';
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(url)
          .set('X-Upload-Token', publicUploadToken)
          .attach('photo', samplePng, {
            filename: 'photo.png',
            contentType: 'image/png',
          }),
      ),
    );
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    const files = await readdir(
      join(process.cwd(), 'uploads', 'purchase-requests'),
    );
    expect(
      files.filter((file) => file.startsWith(publicItemIds[1] + '-')),
    ).toHaveLength(1);
  });

  it('rechecks status after waiting for a concurrent processing transaction', async () => {
    const itemId = publicItemIds[4];
    const url =
      '/api/v1/purchase-requests/public/' +
      publicRequestId +
      '/items/' +
      itemId +
      '/photo';
    const directory = join(process.cwd(), 'uploads', 'purchase-requests');
    let upload: Promise<request.Response> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM e2e."PurchaseRequest" WHERE id = ${publicRequestId} FOR UPDATE`;
      upload = request(app.getHttpServer())
        .post(url)
        .set('X-Upload-Token', publicUploadToken)
        .attach('photo', samplePng, {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .then((response) => response);
      // The temporary file proves the upload passed its initial NEW check.
      let written = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        written = (await readdir(directory)).some((file) =>
          file.startsWith(itemId + '-'),
        );
        if (written) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(written).toBe(true);
      await tx.purchaseRequest.update({
        where: { id: publicRequestId },
        data: { status: 'IN_REVIEW' },
      });
    });
    expect((await upload!).status).toBe(409);
    expect(
      (await readdir(directory)).filter((file) =>
        file.startsWith(itemId + '-'),
      ),
    ).toHaveLength(0);
    const item = await prisma.purchaseRequestItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(item.photoPath).toBeNull();
  });

  it('rate limits abusive public submissions including case variants and spoofed forwarding headers', async () => {
    let received429 = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post(
          attempt % 2
            ? '/api/v1/PURCHASE-REQUESTS/PUBLIC'
            : '/api/v1/purchase-requests/public',
        )
        .set('X-Forwarded-For', '192.0.2.' + attempt)
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
