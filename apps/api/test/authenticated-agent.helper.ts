import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import type { PrismaService } from '../src/prisma/prisma.service.js';

type TestRole = 'EMPLOYEE' | 'PROCUREMENT' | 'ADMIN';

/**
 * Log in through the real public auth endpoints.
 * Only use this helper against the isolated E2E database schema.
 */
export async function createAuthenticatedAgent(
  app: INestApplication,
  prisma: PrismaService,
  role: TestRole,
) {
  const client = request.agent(app.getHttpServer());
  const username = `e2e_${role.toLowerCase()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const password = 'Strong-Test-Password-2026';

  const registered = await client
    .post('/api/v1/auth/register')
    .send({
      fullName: `E2E ${role}`,
      username,
      password,
    })
    .expect(201);

  const userId = registered.body.user.id as string;

  await prisma.user.update({
    where: { id: userId },
    data: { status: 'ACTIVE', role },
  });

  await client
    .post('/api/v1/auth/login')
    .send({ username, password })
    .expect(200);

  return { client, userId };
}
