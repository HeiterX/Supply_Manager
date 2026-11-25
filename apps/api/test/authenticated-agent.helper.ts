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

  const csrfResponse = await client
    .get('/api/v1/auth/csrf')
    .expect(200);

  const token: unknown = csrfResponse.body.csrfToken;

  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    throw new Error('Некорректный тестовый CSRF-токен');
  }

  const protectedMethods = new Set([
    'post',
    'put',
    'patch',
    'delete',
  ]);

  const protectedClient = new Proxy(client, {
    get(target, property, receiver) {
      const original: unknown = Reflect.get(
        target,
        property,
        receiver,
      );

      if (typeof original !== 'function') {
        return original;
      }

      if (protectedMethods.has(String(property))) {
        return (url: string) => {
          const method = original as (
            path: string,
          ) => ReturnType<typeof client.post>;

          return method
            .call(target, url)
            .set('X-CSRF-Token', token);
        };
      }

      return original.bind(target);
    },
  });

  return {
    client: protectedClient,
    userId,
    csrfToken: token,
  };
}
