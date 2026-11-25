import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  TelegramService,
  TelegramFailure,
} from '../src/telegram/telegram.service.js';
import { TelegramLinkService } from '../src/telegram/telegram-link.service.js';
import { TelegramDeliveryService } from '../src/telegram/telegram-delivery.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

describe('Telegram integration (isolated PostgreSQL, mocked Bot API)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let links: TelegramLinkService;
  let deliveries: TelegramDeliveryService;
  let employee: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let buyer: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let admin: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let sequence = 900_000_000;
  const chat = 700_001;
  const secret = 'core10-webhook-test-secret-with-32-characters';
  const origin = 'http://localhost:3001';
  const send = vi.fn().mockResolvedValue({ message_id: 42 });
  const answer = vi.fn().mockResolvedValue(undefined);
  const createdTasks: string[] = [];
  const createdRequests: string[] = [];
  const token = (url: string) => new URL(url).searchParams.get('start')!;
  const webhook = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', secret)
      .send(body);
  const message = (text: string, id = chat) => ({
    update_id: ++sequence,
    message: {
      message_id: sequence,
      from: { id, username: 'test_account' },
      chat: { id, type: 'private' },
      text,
    },
  });
  const callback = (data: string, id = randomUUID(), from = chat) => ({
    update_id: ++sequence,
    callback_query: {
      id,
      from: { id: from },
      data,
      message: { message_id: sequence, chat: { id: from, type: 'private' } },
    },
  });
  const lastText = async () =>
    (
      await prisma.telegramDelivery.findFirstOrThrow({
        where: { eventKey: `update:${sequence}` },
      })
    ).text;

  beforeAll(async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'synthetic-only-no-real-token');
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'supply_test_bot');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', secret);
    vi.stubEnv('FRONTEND_ORIGIN', origin);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramService)
      .useValue({ send, answer, isConfigured: () => true })
      .compile();
    app = module.createNestApplication();
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
    links = app.get(TelegramLinkService);
    deliveries = app.get(TelegramDeliveryService);
    employee = await createAuthenticatedAgent(app, prisma, 'EMPLOYEE');
    buyer = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    admin = await createAuthenticatedAgent(app, prisma, 'ADMIN');
  });
  afterAll(async () => {
    await prisma.telegramDelivery.deleteMany({
      where: { eventKey: { startsWith: 'update:9' } },
    });
    await prisma.telegramUpdateReceipt.deleteMany({
      where: { updateId: { gte: 900_000_000n } },
    });
    await prisma.telegramRate.deleteMany({
      where: { chatId: { startsWith: '70000' } },
    });
    const ids = [employee.userId, buyer.userId, admin.userId];
    await prisma.telegramButton.deleteMany({ where: { userId: { in: ids } } });
    await prisma.purchaseRequest.deleteMany({
      where: { id: { in: createdRequests } },
    });
    await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
    vi.unstubAllEnvs();
  });

  it('requires cookie auth and CSRF origin; rejects forged webhook', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/telegram/settings')
      .expect(401);
    await employee.client.post('/api/v1/telegram/link').expect(403);
    await employee.client
      .post('/api/v1/telegram/link')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/telegram/webhook')
      .send(message('/start'))
      .expect(401);
    await webhook({ update_id: 'bad' }).expect(400);
  });
  it('stores only token hashes and requires confirmation by the original web user', async () => {
    const response = await employee.client
      .post('/api/v1/telegram/link')
      .set('Origin', origin)
      .expect(201);
    const raw = token(response.body.url);
    const stored = await prisma.telegramLink.findFirstOrThrow({
      where: { userId: employee.userId },
    });
    expect(stored.tokenHash).not.toContain(raw);
    expect(stored.tokenHash).toHaveLength(64);
    await webhook(message(`/start ${raw}`)).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: employee.userId } }))
        .telegramChatId,
    ).toBeNull();
    await buyer.client
      .post(`/api/v1/telegram/link/${stored.id}/confirm`)
      .set('Origin', origin)
      .expect(400);
    await employee.client
      .post(`/api/v1/telegram/link/${stored.id}/confirm`)
      .set('Origin', origin)
      .expect(201);
    expect((await links.status(employee.userId)).chatId).toBe(String(chat));
    await webhook(message(`/start ${raw}`, chat + 1)).expect(200);
    expect(await lastText()).toContain('недействительна');
  });
  it('does not link group chats or accept arbitrary Telegram IDs', async () => {
    const begin = await links.begin(buyer.userId);
    const group = message(`/start ${token(begin.url)}`, chat + 1);
    group.message.chat.type = 'group';
    await webhook(group).expect(200);
    expect((await links.status(buyer.userId)).pending?.chatId).toBeNull();
    await buyer.client
      .post('/api/v1/telegram/link')
      .set('Origin', origin)
      .send({ telegramChatId: '123' })
      .expect(201);
    expect((await links.status(buyer.userId)).connected).toBe(false);
  });
  it('rejects expired links and rotation invalidates old tokens', async () => {
    const first = await links.begin(buyer.userId);
    await prisma.telegramLink.updateMany({
      where: { userId: buyer.userId },
      data: { expiresAt: new Date(0) },
    });
    await webhook(message(`/start ${token(first.url)}`, chat + 1)).expect(200);
    expect(await lastText()).toContain('истекла');
    const second = await links.begin(buyer.userId);
    await links.begin(buyer.userId);
    await webhook(message(`/start ${token(second.url)}`, chat + 1)).expect(200);
    expect(await lastText()).toContain('недействительна');
  });
  it('prevents one Telegram account linking to two users', async () => {
    const begin = await links.begin(buyer.userId);
    await webhook(message(`/start ${token(begin.url)}`)).expect(200);
    expect((await links.status(buyer.userId)).pending?.chatId).toBeNull();
  });

  it('serializes simultaneous token claims and rejects a different Telegram account replay', async () => {
    const begin = await links.begin(buyer.userId);
    const raw = token(begin.url);
    await Promise.all([
      webhook(message(`/start ${raw}`, chat + 5)).expect(200),
      webhook(message(`/start ${raw}`, chat + 6)).expect(200),
    ]);
    const pending = (await links.status(buyer.userId)).pending!;
    expect([String(chat + 5), String(chat + 6)]).toContain(pending.chatId);
    const original = pending.chatId;
    await webhook(message(`/start ${raw}`, chat + 7)).expect(200);
    expect((await links.status(buyer.userId)).pending?.chatId).toBe(original);
    const messages = await prisma.telegramDelivery.findMany({
      select: { text: true },
    });
    expect(messages.some((m) => m.text.includes(raw))).toBe(false);
    await links.unlink(buyer.userId);
  });
  it('allows unlink and relink; prevents reuse after confirmation', async () => {
    await employee.client
      .delete('/api/v1/telegram/link')
      .set('Origin', origin)
      .expect(200);
    expect((await links.status(employee.userId)).connected).toBe(false);
    const begin = await links.begin(employee.userId);
    await webhook(message(`/start ${token(begin.url)}`)).expect(200);
    const pending = (await links.status(employee.userId)).pending!;
    await links.confirm(employee.userId, pending.id);
    await expect(links.confirm(employee.userId, pending.id)).rejects.toThrow();
  });
  it('restricts EMPLOYEE to own requests and rejects procurement categories/status', async () => {
    const mine = await prisma.purchaseRequest.create({
      data: { title: 'own', requesterId: employee.userId },
    });
    createdRequests.push(mine.id);
    const other = await prisma.purchaseRequest.create({
      data: { title: 'other', requesterId: buyer.userId },
    });
    createdRequests.push(other.id);
    await webhook(message('/tasks')).expect(200);
    expect(await lastText()).toContain(`№${mine.number}`);
    expect(await lastText()).not.toContain(`№${other.number}`);
    await webhook(message('/status 1')).expect(200);
    expect(await lastText()).toContain('недоступен');
    await employee.client
      .patch('/api/v1/telegram/subscriptions')
      .set('Origin', origin)
      .send({ category: 'OVERDUE', enabled: true })
      .expect(403);
    expect((await links.status(employee.userId)).subscriptions).toEqual([]);
  });
  it('deduplicates concurrent updates and callbacks; never performs legacy accept', async () => {
    const update = message('/menu');
    await Promise.all([
      webhook(update).expect(200),
      webhook(update).expect(200),
    ]);
    expect(
      await prisma.telegramDelivery.count({
        where: { eventKey: `update:${update.update_id}` },
      }),
    ).toBe(1);
    const button = await prisma.telegramButton.findFirstOrThrow({
      where: { userId: employee.userId, command: '/tasks', usedAt: null },
    });
    const cb = callback(button.id);
    await webhook(cb).expect(200);
    await webhook({ ...cb, update_id: ++sequence }).expect(200);
    expect(
      await prisma.telegramDelivery.count({
        where: { eventKey: `update:${cb.update_id}` },
      }),
    ).toBe(1);
    const before = await prisma.purchaseRequest.findUniqueOrThrow({
      where: { id: createdRequests[0] },
    });
    await webhook(callback(`accept_request:${createdRequests[0]}`)).expect(200);
    expect(
      (
        await prisma.purchaseRequest.findUniqueOrThrow({
          where: { id: createdRequests[0] },
        })
      ).taskId,
    ).toBe(before.taskId);
    expect(await lastText()).toContain('устарела');
  });
  it('rejects expired, reused and foreign buttons', async () => {
    const id = 'f'.repeat(32);
    await prisma.telegramButton.create({
      data: {
        id,
        userId: buyer.userId,
        command: '/tasks',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await webhook(callback(id)).expect(200);
    expect(await lastText()).toContain('устарела');
    await prisma.telegramButton.update({
      where: { id },
      data: { userId: employee.userId, expiresAt: new Date(0) },
    });
    await webhook(callback(id)).expect(200);
    expect(await lastText()).toContain('устарела');
  });
  it('rechecks blocked users and changed roles', async () => {
    await prisma.user.update({
      where: { id: employee.userId },
      data: { status: 'BLOCKED' },
    });
    await employee.client.get('/api/v1/telegram/settings').expect(401);
    await webhook(message('/tasks')).expect(200);
    expect(await lastText()).toContain('подключите');
    await prisma.user.update({
      where: { id: employee.userId },
      data: { status: 'ACTIVE', role: 'PROCUREMENT' },
    });
    const task = await prisma.task.create({
      data: { title: 'Telegram task', nextAction: 'Review' },
    });
    createdTasks.push(task.id);
    await webhook(message(`/status ${task.number}`)).expect(200);
    expect(await lastText()).toContain('Review');
    const row = await prisma.telegramDelivery.findFirstOrThrow({
      where: { eventKey: `update:${sequence}` },
    });
    await prisma.user.update({
      where: { id: employee.userId },
      data: { role: 'EMPLOYEE' },
    });
    await deliveries.drain();
    expect(
      (
        await prisma.telegramDelivery.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).status,
    ).toBe('CANCELLED');
  });
  it('routes new request notifications only to explicitly configured eligible recipients', async () => {
    await prisma.user.update({
      where: { id: buyer.userId },
      data: { telegramChatId: String(chat + 2) },
    });
    const buyerUser = await prisma.user.findUniqueOrThrow({
      where: { id: buyer.userId },
    });
    vi.stubEnv('TELEGRAM_REQUEST_RECIPIENT_USERNAMES', buyerUser.username);
    const response = await employee.client
      .post('/api/v1/purchase-requests')
      .send({
        title: 'test notification',
        items: [{ name: 'Synthetic', quantity: 1, unit: 'шт' }],
      })
      .expect(201);
    createdRequests.push(response.body.id);
    const rows = await prisma.telegramDelivery.findMany({
      where: { eventKey: `request:${response.body.id}:created` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(buyer.userId);
    expect(rows[0].text).not.toContain('Synthetic');
  });
  it('deduplicates CORE-09 events and honors subscriptions both before queue and delivery', async () => {
    const event = {
      id: `core09:${randomUUID()}`,
      category: 'DUE_SOON' as const,
      recipientIds: [buyer.userId, employee.userId],
      text: 'Due soon',
      path: '/actions',
    };
    await prisma.$transaction((tx) => deliveries.publish(tx, event));
    await prisma.$transaction((tx) => deliveries.publish(tx, event));
    expect(
      await prisma.telegramDelivery.count({ where: { eventKey: event.id } }),
    ).toBe(1);
    await links.subscribe(buyer.userId, 'DUE_SOON', false);
    await deliveries.drain();
    expect(
      (
        await prisma.telegramDelivery.findFirstOrThrow({
          where: { eventKey: event.id },
        })
      ).status,
    ).toBe('CANCELLED');
    await prisma.$transaction((tx) =>
      deliveries.publish(tx, { ...event, id: event.id + ':disabled' }),
    );
    expect(
      await prisma.telegramDelivery.count({
        where: { eventKey: event.id + ':disabled' },
      }),
    ).toBe(0);
  });
  it('handles 429 backoff, finite retries, blocking and ambiguous network errors', async () => {
    const enqueue = async () => {
      const key = `delivery-test:${randomUUID()}`;
      await prisma.$transaction((tx) =>
        deliveries.queue(tx, key, String(chat + 2), 'test', buyer.userId),
      );
      return prisma.telegramDelivery.findFirstOrThrow({
        where: { eventKey: key },
      });
    };
    await deliveries.drain();
    send.mockClear();
    const rate = await enqueue();
    send.mockRejectedValueOnce(new TelegramFailure('429', 20));
    await deliveries.drain();
    const retry = await prisma.telegramDelivery.findUniqueOrThrow({
      where: { id: rate.id },
    });
    expect(retry.status).toBe('PENDING');
    expect(retry.attempts).toBe(1);
    expect(retry.availableAt.getTime()).toBeGreaterThan(Date.now() + 18_000);
    await prisma.telegramDelivery.update({
      where: { id: rate.id },
      data: { attempts: 4, availableAt: new Date(0) },
    });
    send.mockRejectedValueOnce(new TelegramFailure('503'));
    await deliveries.drain();
    expect(
      (
        await prisma.telegramDelivery.findUniqueOrThrow({
          where: { id: rate.id },
        })
      ).status,
    ).toBe('FAILED');
    const network = await enqueue();
    send.mockRejectedValueOnce(new TelegramFailure('NETWORK'));
    await deliveries.drain();
    expect(
      (
        await prisma.telegramDelivery.findUniqueOrThrow({
          where: { id: network.id },
        })
      ).status,
    ).toBe('UNKNOWN');
    const blocked = await enqueue();
    send.mockRejectedValueOnce(new TelegramFailure('403'));
    await deliveries.drain();
    expect(
      (
        await prisma.telegramDelivery.findUniqueOrThrow({
          where: { id: blocked.id },
        })
      ).status,
    ).toBe('FAILED');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: buyer.userId } }))
        .telegramMuted,
    ).toBe(true);
  });
  it('allows ADMIN commands, rate-limits floods and rejects mismatched chat identity', async () => {
    await prisma.user.update({
      where: { id: admin.userId },
      data: { telegramChatId: String(chat + 3) },
    });
    await webhook(message('/menu', chat + 3)).expect(200);
    expect(await lastText()).toContain('ADMIN');
    const malformed = message('/tasks', chat + 3);
    malformed.message.from.id = chat + 4;
    await webhook(malformed).expect(200);
    expect(
      await prisma.telegramDelivery.count({
        where: { eventKey: `update:${malformed.update_id}` },
      }),
    ).toBe(0);
    for (let i = 0; i < 22; i++)
      await webhook(message('/help', chat + 3)).expect(200);
    expect(
      await prisma.telegramDelivery.count({
        where: { eventKey: `update:${sequence}` },
      }),
    ).toBe(0);
  });

  it('publishes task changes transactionally to configured procurement recipients', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: buyer.userId },
    });
    await prisma.user.update({
      where: { id: buyer.userId },
      data: { telegramMuted: false },
    });
    vi.stubEnv('TELEGRAM_PURCHASE_RECIPIENT_USERNAMES', user.username);
    const response = await buyer.client
      .patch(`/api/v1/tasks/${createdTasks[0]}`)
      .send({ status: 'SEARCHING', nextAction: 'Call supplier' })
      .expect(200);
    expect(response.body.status).toBe('SEARCHING');
    const rows = await prisma.telegramDelivery.findMany({
      where: { category: 'PURCHASE_CHANGED', userId: buyer.userId },
    });
    expect(
      rows.some(
        (r) => r.text.includes('SEARCHING') && r.text.includes('Call supplier'),
      ),
    ).toBe(true);
  });

  it('claims deliveries once across concurrent workers and preserves ambiguous expired leases', async () => {
    await deliveries.drain();
    send.mockClear();
    const key = `concurrent:${randomUUID()}`;
    await prisma.$transaction((tx) =>
      deliveries.queue(tx, key, String(chat + 2), 'concurrent', buyer.userId),
    );
    await Promise.all([deliveries.drain(), deliveries.drain()]);
    expect(
      send.mock.calls.filter((call) => call[1] === 'concurrent'),
    ).toHaveLength(1);
    expect(
      (
        await prisma.telegramDelivery.findFirstOrThrow({
          where: { eventKey: key },
        })
      ).status,
    ).toBe('SENT');
    const expired = await prisma.telegramDelivery.create({
      data: {
        eventKey: `lease:${randomUUID()}`,
        recipientKey: buyer.userId,
        userId: buyer.userId,
        chatId: String(chat + 2),
        text: 'unknown',
        status: 'SENDING',
        leaseUntil: new Date(0),
      },
    });
    send.mockClear();
    await deliveries.drain();
    expect(send.mock.calls.some((call) => call[1] === 'unknown')).toBe(false);
    expect(
      (
        await prisma.telegramDelivery.findUniqueOrThrow({
          where: { id: expired.id },
        })
      ).status,
    ).toBe('UNKNOWN');
  });
});
