import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { NextActionsService } from '../src/next-actions/next-actions.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

type Agent = Awaited<ReturnType<typeof createAuthenticatedAgent>>;
const api = '/api/v1/next-actions';

describe('CORE-09: owned actions, optimistic updates, schedules and notifications', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: NextActionsService;
  let owner: Agent;
  let other: Agent;
  let admin: Agent;
  let employee: Agent;
  const tasks: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(NextActionsService);
    owner = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    other = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    admin = await createAuthenticatedAgent(app, prisma, 'ADMIN');
    employee = await createAuthenticatedAgent(app, prisma, 'EMPLOYEE');
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.task.deleteMany({ where: { id: { in: tasks } } });
      for (const agent of [owner, other, admin, employee]) {
        if (agent?.userId) await prisma.user.deleteMany({ where: { id: agent.userId } });
      }
    }
    if (app) await app.close();
  });

  async function fixture() {
    const result = await owner.client.post('/api/v1/tasks')
      .send({ title: 'CORE09 action ' + randomUUID() }).expect(201);
    const taskId = result.body.id as string;
    tasks.push(taskId);
    const action = await owner.client.get(api + '/by-task/' + taskId).expect(200);
    expect(action.body.action).toMatchObject({
      title: 'Определить следующий шаг закупки',
      assignee: { id: owner.userId },
      version: 1,
    });
    return { taskId, actionId: action.body.action.id as string };
  }

  it('separates action due date from overall purchase deadline and blocks foreign users', async () => {
    const { taskId, actionId } = await fixture();
    await request(app.getHttpServer()).get(api + '/by-task/' + taskId).expect(401);
    await employee.client.get(api + '/by-task/' + taskId).expect(403);
    await other.client.get(api + '/by-task/' + taskId).expect(404);
    await other.client.patch(api + '/' + actionId)
      .set('If-Match', '"1"').set('Idempotency-Key', randomUUID())
      .send({ title: 'Попытка изменить чужое действие' }).expect(404);
    const updated = await owner.client.patch(api + '/' + actionId)
      .set('If-Match', '"1"').set('Idempotency-Key', randomUUID())
      .send({ title: 'Уточнить количество позиций', dueAt: '2027-02-02T10:00:00.000Z' })
      .expect(200);
    expect(updated.body.version).toBe(2);
    expect(updated.body.dueAt).toBe('2027-02-02T10:00:00.000Z');
    const task = await owner.client.get('/api/v1/tasks/' + taskId).expect(200);
    expect(task.body.deadline).toBeNull();
  });

  it('is idempotent under retries and rejects stale versions and changed payloads', async () => {
    const { actionId } = await fixture();
    const key = randomUUID();
    const path = api + '/' + actionId;
    const payload = { title: 'Проверить наличие товара', dueAt: '2027-02-03T12:00:00.000Z' };
    const headers = (agent: Agent, version: number, idempotencyKey = key) =>
      agent.client.patch(path).set('If-Match', '"' + version + '"').set('Idempotency-Key', idempotencyKey);
    const first = await headers(owner, 1).send(payload).expect(200);
    const replay = await headers(owner, 1).send(payload).expect(200);
    expect(replay.body).toEqual(first.body);
    await headers(owner, 1).send({ title: 'Изменено при повторе' }).expect(409);
    await headers(owner, 1, randomUUID()).send(payload).expect(409);
    const history = await owner.client.get(path + '/history').expect(200);
    expect(history.body.items.map((item: { type: string }) => item.type)).toEqual(['RESCHEDULED','CREATED']);
  });

  it('notifies only the assignee and dispatches due/overdue once per version', async () => {
    const { actionId } = await fixture();
    const now = Date.now();
    const remind = new Date(now + 180000).toISOString();
    const due = new Date(now + 360000).toISOString();
    await owner.client.patch(api + '/' + actionId)
      .set('If-Match', '"1"').set('Idempotency-Key', randomUUID())
      .send({ dueAt: due, reminderAt: remind }).expect(200);
    await service.dispatchDue(new Date(now + 240000));
    await service.dispatchDue(new Date(now + 240000));
    let notifications = await owner.client.get('/api/v1/notifications').expect(200);
    expect(notifications.body.items.filter((n: { type: string }) => n.type === 'ACTION_DUE')).toHaveLength(1);
    expect((await other.client.get('/api/v1/notifications').expect(200)).body.unreadCount).toBe(0);
    await service.dispatchDue(new Date(now + 420000));
    await service.dispatchDue(new Date(now + 420000));
    notifications = await owner.client.get('/api/v1/notifications').expect(200);
    expect(notifications.body.items.filter((n: { type: string }) => n.type === 'ACTION_OVERDUE')).toHaveLength(1);
    const id = notifications.body.items[0].id as string;
    await owner.client.patch('/api/v1/notifications/' + id + '/read').expect(200);
    await owner.client.patch('/api/v1/notifications/' + id + '/read').expect(200);
    await other.client.patch('/api/v1/notifications/' + id + '/read').expect(404);
    const after = await owner.client.get('/api/v1/notifications?filter=unread').expect(200);
    expect(after.body.unreadCount).toBe(1);
    await service.dispatchDue(new Date(now + 86_400_000 + 420_000));
    await service.dispatchDue(new Date(now + 86_400_000 + 420_000));
    const tomorrow = await owner.client.get('/api/v1/notifications').expect(200);
    expect(tomorrow.body.items.filter((n: { type: string }) => n.type === 'ACTION_OVERDUE')).toHaveLength(2);
  });

  it('allows completion, preserves immutable history and creates a successor', async () => {
    const { taskId, actionId } = await fixture();
    const completed = await owner.client.post(api + '/' + actionId + '/complete')
      .set('If-Match', '"1"').set('Idempotency-Key', randomUUID()).expect(201);
    expect(completed.body.status).toBe('COMPLETED');
    const empty = await owner.client.get(api + '/by-task/' + taskId).expect(200);
    expect(empty.body.action).toBeNull();
    expect(empty.body.lastActionId).toBe(actionId);
    const next = await owner.client.post(api + '/by-task/' + taskId)
      .send({ title: 'Запросить документы поставщика' }).expect(201);
    expect(next.body.id).not.toBe(actionId);
    await owner.client.post(api + '/by-task/' + taskId)
      .send({ title: 'Второе действие одновременно' }).expect(409);
    const allHistory = await owner.client.get(api + '/' + actionId + '/history').expect(200);
    expect(allHistory.body.items.map((i: { type: string }) => i.type)).toContain('COMPLETED');
  });

  it('supports admin transfer, restricts procurement reassignment and protects open actions', async () => {
    const { taskId, actionId } = await fixture();
    await owner.client.patch(api + '/' + actionId)
      .set('If-Match', '"1"').set('Idempotency-Key', randomUUID())
      .send({ assigneeId: other.userId }).expect(403);
    const transfer = await admin.client.patch(api + '/' + actionId)
      .set('If-Match', '"1"').set('Idempotency-Key', randomUUID())
      .send({ assigneeId: other.userId }).expect(200);
    expect(transfer.body.assignee.id).toBe(other.userId);
    await owner.client.get(api + '/by-task/' + taskId).expect(404);
    await other.client.get(api + '/by-task/' + taskId).expect(200);
    const changed = await admin.client.patch(api + '/' + actionId)
      .set('If-Match', '"2"').set('Idempotency-Key', randomUUID())
      .send({ dueAt: '2027-02-10T12:00:00.000Z' }).expect(200);
    expect(changed.body.version).toBe(3);
    const inbox = await other.client.get('/api/v1/notifications').expect(200);
    expect(inbox.body.items.some((n: { type: string }) => n.type === 'DUE_DATE_CHANGED')).toBe(true);
    expect((await owner.client.get('/api/v1/notifications').expect(200)).body.unreadCount).toBe(0);
    const all = await admin.client.get(api + '?scope=all').expect(200);
    expect(all.body.items.some((a: { id: string }) => a.id === actionId)).toBe(true);
  });
});
