import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

type Agent = Awaited<ReturnType<typeof createAuthenticatedAgent>>;

describe('CORE-05: catalog, procurement line invariants and audit', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let procurement: Agent;
  let employee: Agent;

  const taskIds: string[] = [];
  const catalogIds: string[] = [];
  const requestIds: string[] = [];

  let taskId = '';
  let catalogId = '';
  let itemId = '';
  let offerId = '';
  let offerLineId = '';
  let orderId = '';

  const api = '/api/v1';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
    prisma = app.get(PrismaService);
    procurement = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    employee = await createAuthenticatedAgent(app, prisma, 'EMPLOYEE');
  });

  afterAll(async () => {
    if (prisma) {
      if (requestIds.length) {
        await prisma.purchaseRequest.deleteMany({ where: { id: { in: requestIds } } });
      }
      if (taskIds.length) {
        await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      }
      if (catalogIds.length) {
        await prisma.catalogItem.deleteMany({ where: { id: { in: catalogIds } } });
      }
      for (const agent of [procurement, employee]) {
        if (agent?.userId) {
          await prisma.user.deleteMany({ where: { id: agent.userId } });
        }
      }
    }
    if (app) await app.close();
  });

  it('restricts catalog endpoints by role and authentication', async () => {
    const { default: request } = await import('supertest');
    await request(app.getHttpServer()).get(`${api}/catalog`).expect(401);
    await employee.client.get(`${api}/catalog`).expect(403);
    await employee.client.post(`${api}/catalog`).send({
      name: 'Каталог E2E', unit: 'шт.',
    }).expect(403);
  });

  it('creates catalog, finds by part number and rejects normalized duplicate', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const partNumber = `CORE05-6205-${suffix}`;
    const first = await procurement.client.post(`${api}/catalog`).send({
      name: 'Подшипник 6205',
      partNumber,
      category: 'Подшипники',
      unit: 'шт.',
      attributes: { 'Диаметр': '25 мм' },
    }).expect(201);

    catalogId = first.body.id as string;
    catalogIds.push(catalogId);

    await procurement.client.post(`${api}/catalog`).send({
      name: '  ПОДШИПНИК   6205  ',
      partNumber: partNumber.toLowerCase(),
      category: 'Подшипники',
      unit: 'шт.',
      attributes: { 'Диаметр': '25 мм' },
    }).expect(409);

    const listed = await procurement.client.get(
      `${api}/catalog?q=${encodeURIComponent(partNumber)}`,
    ).expect(200);
    expect((listed.body as Array<{ id: string }>).some(x => x.id === catalogId)).toBe(true);

    const variant = await procurement.client.post(`${api}/catalog`).send({
      name: 'Подшипник 6205',
      partNumber,
      category: 'Подшипники',
      unit: 'шт.',
      attributes: { 'Диаметр': '26 мм' },
    }).expect(201);

    catalogIds.push(variant.body.id as string);
    expect(variant.body.id).not.toBe(catalogId);
  });

  it('validates nested attributes and line quantity', async () => {
    await procurement.client.post(`${api}/catalog`).send({
      name: 'Подшипник', unit: 'шт.',
      attributes: { diameter: { value: '25mm' } },
    }).expect(400);

    const task = await procurement.client.post(`${api}/tasks`).send({
      title: `CORE-05 task ${randomUUID()}`,
    }).expect(201);
    taskId = task.body.id as string;
    taskIds.push(taskId);

    await procurement.client.post(`${api}/tasks/${taskId}/items`).send({
      name: 'Неверное количество',
      quantity: 0,
      unit: 'шт.',
    }).expect(400);

    await procurement.client.post(`${api}/tasks/${taskId}/items`).send({
      name: 'Неверная единица',
      quantity: 1,
      unit: '',
    }).expect(400);
  });

  it('links an exact variant without overwriting the original snapshot', async () => {
    const response = await procurement.client.post(`${api}/tasks/${taskId}/items`).send({
      name: 'Подшипник 6205',
      partNumber: (await prisma.catalogItem.findUniqueOrThrow({
        where: { id: catalogId },
      })).partNumber,
      quantity: 4,
      unit: 'шт.',
      notes: 'Исходная спецификация',
      catalogItemId: catalogId,
      technicalParameters: { 'Диаметр': '25 мм' },
    }).expect(201);

    itemId = response.body.id as string;
    expect(response.body.catalogItemId).toBe(catalogId);
    expect(response.body.originalSnapshot).toMatchObject({
      quantity: '4', notes: 'Исходная спецификация',
    });
    await procurement.client.post(`${api}/tasks/${taskId}/items`).send({
      name: 'Подшипник 6205',
      quantity: 1,
      unit: 'кг',
      catalogItemId: catalogId,
      technicalParameters: { 'Диаметр': '25 мм' },
    }).expect(409);
  });

  it('keeps old and new specification snapshots in history', async () => {
    await procurement.client.patch(`${api}/tasks/${taskId}/items/${itemId}`).send({
      quantity: 5,
      notes: 'Уточнённая потребность',
    }).expect(200);

    const task = await procurement.client.get(`${api}/tasks/${taskId}`).expect(200);
    const line = (task.body.items as Array<{
      id: string; originalSnapshot: { quantity: string };
    }>).find(x => x.id === itemId);
    expect(line?.originalSnapshot.quantity).toBe('4');

    const audit = task.body.itemChanges as Array<{
      action: string; oldValue: { quantity?: string } | null;
      newValue: { quantity?: string } | null;
    }>;
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'UPDATED',
        oldValue: expect.objectContaining({ quantity: '4' }),
        newValue: expect.objectContaining({ quantity: '5' }),
      }),
    ]));
  });

  it('blocks deletion or editing with a linked commercial offer', async () => {
    const offer = await procurement.client.post(`${api}/tasks/${taskId}/supplier-offers`).send({
      supplierName: `Поставщик CORE-05-${randomUUID().slice(0, 8)}`,
      currency: 'RUB',
      items: [{
        taskItemId: itemId,
        quantity: 3,
        unitPrice: 250,
        currency: 'RUB',
      }],
    }).expect(201);
    offerId = offer.body.id as string;
    offerLineId = offer.body.items[0].id as string;

    await procurement.client.patch(`${api}/tasks/${taskId}/items/${itemId}`).send({
      quantity: 1,
    }).expect(409);
    await procurement.client.delete(`${api}/tasks/${taskId}/items/${itemId}`).expect(409);

    const task = await procurement.client.get(`${api}/tasks/${taskId}`).expect(200);
    const line = (task.body.items as Array<{ id: string; progress: { offered: number } }>)
      .find((x) => x.id === itemId);
    expect(line?.progress.offered).toBe(3);
  });

  it('orders only offered amounts and displays ordered, received and handed-over progress', async () => {
    await procurement.client.patch(`${api}/tasks/${taskId}/supplier-offers/${offerId}/decision`)
      .send({ reason: 'Техническое соответствие подтверждено, приемлемые условия поставки' })
      .expect(200);
    const order = await procurement.client.post(
      `${api}/tasks/${taskId}/supplier-offers/${offerId}/purchase-order`,
    ).send({
      invoiceNumber: 'CORE05-TEST',
      invoiceDate: new Date().toISOString(),
      items: [{ supplierOfferItemId: offerLineId, quantity: 2 }],
    }).expect(201);
    orderId = order.body.id as string;

    const progress = async () => {
      const response = await procurement.client.get(`${api}/tasks/${taskId}`).expect(200);
      const line = (response.body.items as Array<{ id: string; progress: {
        required: number; ordered: number; received: number; handedOver: number;
      } }>).find(x => x.id === itemId);
      if (!line) throw new Error('Позиция исчезла');
      return line.progress;
    };

    expect((await progress()).ordered).toBe(2);
    await procurement.client.post(`${api}/tasks/${taskId}/supplier-offers/${offerId}/purchase-order`).send({
      invoiceNumber: 'CORE05-SECOND',
      invoiceDate: new Date().toISOString(),
      items: [{ supplierOfferItemId: offerLineId, quantity: 4 }],
    }).expect(409);

    for (const [action, data] of [
      ['send-to-payment', {}],
      ['confirm-payment', {}],
      ['ship', { shippedAt: new Date().toISOString(), carrier: 'Тестовый перевозчик' }],
      ['ready-for-pickup', {}],
      ['receive', {}],
    ] as const) {
      await procurement.client.patch(
        `${api}/tasks/${taskId}/orders/${orderId}/${action}`,
      ).send(data).expect(200);
    }
    expect((await progress()).received).toBe(2);
    expect((await progress()).handedOver).toBe(0);
    await procurement.client.patch(
      `${api}/tasks/${taskId}/orders/${orderId}/hand-over`,
    ).send({ handedOverTo: 'Сотрудник CORE05' }).expect(200);
    expect((await progress()).handedOver).toBe(2);

    await procurement.client.delete(`${api}/tasks/${taskId}/items/${itemId}`).expect(409);
  });

  it('preserves source request row and specification during conversion', async () => {
    const request = await employee.client.post(`${api}/purchase-requests`).send({
      title: 'CORE05 исходная строка',
      items: [{
        name: 'Клапан DN50',
        partNumber: 'DN50-PN16',
        quantity: 2,
        unit: 'шт.',
        notes: 'Рабочее давление PN16',
      }],
    }).expect(201);
    requestIds.push(request.body.id as string);
    const sourceItemId = request.body.items[0].id as string;
    const accepted = await procurement.client.patch(
      `${api}/purchase-requests/${request.body.id as string}/accept`,
    ).expect(200);
    taskIds.push(accepted.body.task.id as string);
    const linked = await procurement.client.get(
      `${api}/tasks/${accepted.body.task.id as string}`,
    ).expect(200);
    expect(linked.body.items[0]).toMatchObject({
      sourceRequestItemId: sourceItemId,
      partNumber: 'DN50-PN16',
      originalSnapshot: {
        sourceRequestItemId: sourceItemId,
        notes: 'Рабочее давление PN16',
      },
    });
  });
});
