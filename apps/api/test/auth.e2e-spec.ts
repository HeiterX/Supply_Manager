import 'dotenv/config';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId = '';

  const username = `employee_${Date.now()}`;
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
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }

    await app.close();
  });

  it('registers employee as PENDING, activates, logs in and reads session', async () => {
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Тестовый Сотрудник',
        username,
        password,
        department: 'Механический участок',
        position: 'Механик',
      })
      .expect(201);

    userId = registerResponse.body.user.id as string;

    expect(registerResponse.body.user.status).toBe('PENDING');
    expect(registerResponse.body.user.role).toBe('EMPLOYEE');
    expect(registerResponse.body.user.passwordHash).toBeUndefined();

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(403);

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(200);

    expect(loginResponse.body.user.id).toBe(userId);
    expect(loginResponse.body.user.passwordHash).toBeUndefined();

    const setCookie = loginResponse.headers['set-cookie'];
    expect(setCookie).toBeTruthy();

    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toContain('HttpOnly');

    const meResponse = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(meResponse.body.id).toBe(userId);
    expect(meResponse.body.username).toBe(username.toLowerCase());

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
  });

  it('rejects invalid password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password: 'Wrong-Password' })
      .expect(401);
  });
});
