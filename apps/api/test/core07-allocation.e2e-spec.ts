import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

type Agent = Awaited<ReturnType<typeof createAuthenticatedAgent>>;
type Offer = { id: string; supplierId: string; items: Array<{ id: string; taskItemId: string }> };
const api = '/api/v1/tasks';

describe('CORE-07: multi-supplier quantity reservation, idempotency and safe edits', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let procurement: Agent;
  let secondProcurement: Agent;
  let employee: Agent;
  const tasks: string[] = [];
  const suppliers: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
    }));
    await app.init();
    prisma = app.get(PrismaService);
    procurement = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    secondProcurement = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    employee = await createAuthenticatedAgent(app, prisma, 'EMPLOYEE');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.task.updateMany({
        where: { id: { in: tasks } },
        data: { currentPurchaseOrderId: null, selectedOfferId: null },
      });
      await prisma.task.deleteMany({ where: { id: { in: tasks } } });
      await prisma.supplier.deleteMany({ where: { id: { in: suppliers } } });
      for (const agent of [procurement, secondProcurement, employee]) {
        if (agent?.userId) await prisma.user.deleteMany({ where: { id: agent.userId } });
      }
    }
    if (app) await app.close();
  });

  async function fixture(required = 10) {
    const task = await procurement.client.post(api)
      .send({ title: `CORE07 ${randomUUID()}` }).expect(201);
    const taskId = task.body.id as string;
    tasks.push(taskId);
    const item = await procurement.client.post(`${api}/${taskId}/items`)
      .send({ name: `Механическая деталь ${randomUUID().slice(0, 5)}`, quantity: required, unit: 'шт.' })
      .expect(201);
    return { taskId, taskItemId: item.body.id as string };
  }

  async function quote(taskId: string, taskItemId: string, quantity: number, price = 100): Promise<Offer> {
    const offer = await procurement.client.post(`${api}/${taskId}/supplier-offers`).send({
      supplierName: `CORE07 поставщик ${randomUUID()}`,
      currency: 'RUB',
      items: [{ taskItemId, quantity, unitPrice: price, currency: 'RUB' }],
    }).expect(201);
    suppliers.push(offer.body.supplierId as string);
    await procurement.client.patch(`${api}/${taskId}/supplier-offers/${offer.body.id as string}/decision`)
      .send({ reason: 'Техническое соответствие подтверждено, согласованы цена и сроки' })
      .expect(200);
    return offer.body as Offer;
  }

  function newOrder(offer: Offer, quantity: number, idempotencyKey?: string) {
    return {
      invoiceNumber: 'CORE07-INV',
      invoiceDate: '2026-11-24T10:00:00.000Z',
      idempotencyKey,
      items: [{ supplierOfferItemId: offer.items[0].id, quantity }],
    };
  }

  async function allocation(taskId: string, taskItemId: string) {
    const response = await procurement.client.get(`${api}/${taskId}/allocation`).expect(200);
    const row = (response.body as Array<{
      taskItemId: string; required: number; reserved: number;
      ordered: number; cancelled: number; available: number;
      paidOrLater: number; bySupplier: Array<{ supplierId: string }>;
    }>).find(item => item.taskItemId === taskItemId);
    if (!row) throw new Error('Распределение позиции не найдено');
    return row;
  }

  it('reserves partial amounts from two suppliers without exceeding requirement', async () => {
    const { taskId, taskItemId } = await fixture(10);
    const a = await quote(taskId, taskItemId, 6);
    const b = await quote(taskId, taskItemId, 4);
    const c = await quote(taskId, taskItemId, 3);

    const first = await procurement.client.post(
      `${api}/${taskId}/supplier-offers/${a.id}/purchase-order`,
    ).send(newOrder(a, 6, randomUUID())).expect(201);
    const second = await procurement.client.post(
      `${api}/${taskId}/supplier-offers/${b.id}/purchase-order`,
    ).send(newOrder(b, 4, randomUUID())).expect(201);
    expect(first.body.id).not.toBe(second.body.id);
    const state = await allocation(taskId, taskItemId);
    expect(state).toMatchObject({
      required: 10, ordered: 10, reserved: 10, available: 0, cancelled: 0,
    });
    expect(state.bySupplier).toHaveLength(2);
    await procurement.client.post(
      `${api}/${taskId}/supplier-offers/${c.id}/purchase-order`,
    ).send(newOrder(c, 3, randomUUID())).expect(409);
    expect((await allocation(taskId, taskItemId)).available).toBe(0);
  });

  it('replays identical creation safely, rejects changed payload and cannot double-reserve', async () => {
    const { taskId, taskItemId } = await fixture(10);
    const offer = await quote(taskId, taskItemId, 7);
    const key = randomUUID();
    const path = `${api}/${taskId}/supplier-offers/${offer.id}/purchase-order`;
    const original = newOrder(offer, 7, key);
    const first = await procurement.client.post(path).send(original).expect(201);
    const repeat = await procurement.client.post(path).send(original).expect(201);
    expect(first.body.id).toBe(repeat.body.id);
    expect(await prisma.purchaseOrder.count({ where: { taskId } })).toBe(1);
    await procurement.client.post(path).send(newOrder(offer, 5, key)).expect(409);
    const orderId = first.body.id as string;

    await procurement.client.patch(`${api}/${taskId}/orders/${orderId}/cancel`)
      .send({ reason: 'Поставщик не подтвердил наличие' }).expect(200);
    const replayCancelled = await procurement.client.post(path).send(original).expect(201);
    expect(replayCancelled.body.id).toBe(orderId);
    expect(replayCancelled.body.status).toBe('CANCELLED');
    expect(await prisma.purchaseOrder.count({ where: { taskId } })).toBe(1);
    expect((await allocation(taskId, taskItemId))).toMatchObject({
      ordered: 0, reserved: 0, cancelled: 7, available: 10,
    });
  });

  it('edits quantity before payment, releases stock and rejects a stale version', async () => {
    const { taskId, taskItemId } = await fixture(10);
    const firstOffer = await quote(taskId, taskItemId, 8);
    const secondOffer = await quote(taskId, taskItemId, 8);
    const created = await procurement.client.post(
      `${api}/${taskId}/supplier-offers/${firstOffer.id}/purchase-order`,
    ).send(newOrder(firstOffer, 8, randomUUID())).expect(201);

    const editPath = `${api}/${taskId}/orders/${created.body.id as string}`;
    const changed = await procurement.client.patch(editPath).send({
      expectedVersion: 1,
      invoiceNumber: 'CORE07-EDITED',
      items: [{ supplierOfferItemId: firstOffer.items[0].id, quantity: 4 }],
    }).expect(200);
    expect(changed.body.version).toBe(2);
    expect(changed.body.items[0].quantity).toBe('4');
    expect((await allocation(taskId, taskItemId))).toMatchObject({
      ordered: 4, reserved: 4, available: 6,
    });
    await secondProcurement.client.patch(editPath).send({
      expectedVersion: 1,
      items: [{ supplierOfferItemId: firstOffer.items[0].id, quantity: 5 }],
    }).expect(409);
    await procurement.client.patch(editPath).send({
      expectedVersion: 2,
      items: [{ supplierOfferItemId: firstOffer.items[0].id, quantity: 9 }],
    }).expect(409);
    await procurement.client.post(
      `${api}/${taskId}/supplier-offers/${secondOffer.id}/purchase-order`,
    ).send(newOrder(secondOffer, 6, randomUUID())).expect(201);
    expect((await allocation(taskId, taskItemId))).toMatchObject({
      ordered: 10, reserved: 10, available: 0,
    });
    const task = await procurement.client.get(`${api}/${taskId}`).expect(200);
    const revision = (task.body.purchaseOrders as Array<{
      id: string; revisions: Array<{ action: string; version: number }>;
    }>).find(order => order.id === created.body.id);
    expect(revision?.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'CREATED', version: 1 }),
      expect.objectContaining({ action: 'UPDATED', version: 2 }),
    ]));
  });

  it('resets payment submission on edit and blocks editing or cancellation after payment', async () => {
    const { taskId, taskItemId } = await fixture(10);
    const offer = await quote(taskId, taskItemId, 10);
    const created = await procurement.client.post(
      `${api}/${taskId}/supplier-offers/${offer.id}/purchase-order`,
    ).send(newOrder(offer, 5, randomUUID())).expect(201);
    const path = `${api}/${taskId}/orders/${created.body.id as string}`;
    await procurement.client.patch(`${path}/send-to-payment`).expect(200);
    const updated = await procurement.client.patch(path).send({
      expectedVersion: 2,
      items: [{ supplierOfferItemId: offer.items[0].id, quantity: 4 }],
    }).expect(200);
    expect(updated.body.status).toBe('ORDERED');
    expect(updated.body.sentToPaymentAt).toBeNull();
    await procurement.client.patch(`${path}/confirm-payment`).expect(409);
    await procurement.client.patch(`${path}/send-to-payment`).expect(200);
    await procurement.client.patch(`${path}/confirm-payment`).expect(200);
    await procurement.client.patch(path).send({
      expectedVersion: 5,
      items: [{ supplierOfferItemId: offer.items[0].id, quantity: 2 }],
    }).expect(409);
    await procurement.client.patch(`${path}/cancel`)
      .send({ reason: 'Поздняя отмена' }).expect(409);
    const state = await allocation(taskId, taskItemId);
    expect(state).toMatchObject({ reserved: 0, ordered: 4, paidOrLater: 4, available: 6 });
  });

  it('serializes simultaneous orders by two procurement users', async () => {
    const { taskId, taskItemId } = await fixture(10);
    const a = await quote(taskId, taskItemId, 7);
    const b = await quote(taskId, taskItemId, 7);
    const [left, right] = await Promise.all([
      procurement.client.post(`${api}/${taskId}/supplier-offers/${a.id}/purchase-order`)
        .send(newOrder(a, 7, randomUUID())),
      secondProcurement.client.post(`${api}/${taskId}/supplier-offers/${b.id}/purchase-order`)
        .send(newOrder(b, 7, randomUUID())),
    ]);
    const statuses = [left.status, right.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.purchaseOrder.count({ where: { taskId } })).toBe(1);
    expect((await allocation(taskId, taskItemId))).toMatchObject({
      ordered: 7, reserved: 7, available: 3,
    });
  });

  it('requires procurement rights and preserves an unpaid cancellation as history', async () => {
    const { taskId, taskItemId } = await fixture(5);
    const offer = await quote(taskId, taskItemId, 5);
    await request(app.getHttpServer()).get(`${api}/${taskId}/allocation`).expect(401);
    await employee.client.get(`${api}/${taskId}/allocation`).expect(403);
    const endpoint = `${api}/${taskId}/supplier-offers/${offer.id}/purchase-order`;
    await employee.client.post(endpoint).send(newOrder(offer, 5, randomUUID())).expect(403);
    const created = await procurement.client.post(endpoint)
      .send(newOrder(offer, 5, randomUUID())).expect(201);
    const path = `${api}/${taskId}/orders/${created.body.id as string}`;
    await employee.client.patch(path).send({
      expectedVersion: 1,
      items: [{ supplierOfferItemId: offer.items[0].id, quantity: 1 }],
    }).expect(403);
    await procurement.client.patch(`${path}/cancel`).send({ reason: '' }).expect(400);
    await procurement.client.patch(`${path}/cancel`)
      .send({ reason: 'Отказ от заказа до оплаты' }).expect(200);
    await procurement.client.patch(`${path}/cancel`)
      .send({ reason: 'Повторная отмена' }).expect(409);
    const state = await allocation(taskId, taskItemId);
    expect(state).toMatchObject({ ordered: 0, cancelled: 5, available: 5 });
    const task = await procurement.client.get(`${api}/${taskId}`).expect(200);
    const order = (task.body.purchaseOrders as Array<{
      id: string; revisions: Array<{ action: string }>;
    }>).find(o => o.id === created.body.id);
    expect(order?.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'CREATED' }),
      expect.objectContaining({ action: 'CANCELLED' }),
    ]));
  });
});
