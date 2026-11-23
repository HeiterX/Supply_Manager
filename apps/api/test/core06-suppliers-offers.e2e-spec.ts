import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

type Agent = Awaited<ReturnType<typeof createAuthenticatedAgent>>;

describe('CORE-06: supplier directory, quotations, revisions and documents', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let procurement: Agent;
  let employee: Agent;
  let supplierId = '';
  let taskId = '';
  let itemId = '';
  let offerId = '';
  let offerLineId = '';
  let documentId = '';
  const supplierIds: string[] = [];
  const taskIds: string[] = [];
  const uploadedNames: string[] = [];
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const api = '/api/v1';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
    }));
    await app.init();
    prisma = app.get(PrismaService);
    procurement = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    employee = await createAuthenticatedAgent(app, prisma, 'EMPLOYEE');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      for (const agent of [procurement, employee]) {
        if (agent?.userId) await prisma.user.deleteMany({ where: { id: agent.userId } });
      }
    }
    for (const name of uploadedNames) {
      await unlink(join(process.cwd(), 'uploads', 'offer-documents', name))
        .catch(() => undefined);
    }
    if (app) await app.close();
  });

  it('protects supplier directory from employees and unauthenticated requests', async () => {
    await request(app.getHttpServer()).get(`${api}/suppliers`).expect(401);
    await employee.client.get(`${api}/suppliers`).expect(403);
    await employee.client.post(`${api}/suppliers`).send({ name: 'Неавторизованный' }).expect(403);
  });

  it('creates canonical supplier and blocks normalized name/tax ID duplicates', async () => {
    const name = `CORE06 Судовые детали ${suffix}`;
    const created = await procurement.client.post(`${api}/suppliers`).send({
      name, taxId: '1234567890', contact: 'Ирина',
      categories: ['Электрика', 'Механика'],
      responsibleId: procurement.userId,
      status: 'ACTIVE',
    }).expect(201);

    supplierId = created.body.id as string;
    supplierIds.push(supplierId);
    await procurement.client.post(`${api}/suppliers`).send({
      name: name.toUpperCase(), taxId: '1234567890',
    }).expect(409);

    const list = await procurement.client.get(`${api}/suppliers?q=${suffix}`).expect(200);
    expect((list.body as Array<{ id: string }>).some(x => x.id === supplierId)).toBe(true);

    const one = await procurement.client.get(`${api}/suppliers/${supplierId}`).expect(200);
    expect(one.body.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'CREATED', actorId: procurement.userId }),
    ]));
  });

  it('changes supplier status/history and forbids quotes from blocked suppliers', async () => {
    const current = await procurement.client.get(`${api}/suppliers/${supplierId}`).expect(200);
    await procurement.client.patch(`${api}/suppliers/${supplierId}`).send({
      name: current.body.name,
      taxId: current.body.taxId,
      status: 'BLOCKED',
      categories: ['Электрика'],
      responsibleId: procurement.userId,
    }).expect(200);

    const denied = await procurement.client.post(`${api}/tasks`).send({
      title: `CORE06 закупка ${suffix}`,
    }).expect(201);
    taskId = denied.body.id as string;
    taskIds.push(taskId);
    const item = await procurement.client.post(`${api}/tasks/${taskId}/items`).send({
      name: 'Реле управления', quantity: 5, unit: 'шт.',
    }).expect(201);
    itemId = item.body.id as string;

    await procurement.client.post(`${api}/tasks/${taskId}/supplier-offers`).send({
      supplierId,
      currency: 'RUB',
      items: [{ taskItemId: itemId, quantity: 3, unitPrice: 100, currency: 'RUB' }],
    }).expect(409);

    await procurement.client.patch(`${api}/suppliers/${supplierId}`).send({
      name: current.body.name, taxId: current.body.taxId,
      status: 'ACTIVE', categories: ['Электрика'],
      responsibleId: procurement.userId,
    }).expect(200);

    const latest = await procurement.client.get(`${api}/suppliers/${supplierId}`).expect(200);
    expect(latest.body.history.filter((x: { action: string }) => x.action === 'UPDATED')).toHaveLength(2);
  });

  it('creates multiple quotes, reuses supplier, and never fabricates unknown currencies', async () => {
    const offer = await procurement.client.post(`${api}/tasks/${taskId}/supplier-offers`).send({
      supplierId,
      currency: 'RUB',
      deliveryPrice: 30,
      deliveryDays: 7,
      paymentTerms: 'Предоплата 50%',
      deliveryTerms: 'Доставка до Архангельска',
      validUntil: new Date(Date.now() + 14 * 86400000).toISOString(),
      items: [{ taskItemId: itemId, quantity: 3, unitPrice: 100, currency: 'RUB' }],
    }).expect(201);
    offerId = offer.body.id as string;
    offerLineId = offer.body.items[0].id as string;
    expect(offer.body.price).toBe('300');
    expect(offer.body.supplierId).toBe(supplierId);
    expect(offer.body.currency).toBe('RUB');

    const other = await procurement.client.post(`${api}/tasks/${taskId}/supplier-offers`).send({
      supplierName: `Другая компания ${suffix}`,
      deliveryDays: 2,
      items: [{ taskItemId: itemId, quantity: 3, unitPrice: 95 }],
    }).expect(201);
    supplierIds.push(other.body.supplierId as string);
    expect(other.body.currency).toBeNull();
    expect(other.body.price).toBeNull();

    const repeat = await procurement.client.post(`${api}/tasks/${taskId}/supplier-offers`).send({
      supplierName: `CORE06 Судовые детали ${suffix}`,
      currency: 'RUB',
      items: [{ taskItemId: itemId, quantity: 1, unitPrice: 110, currency: 'RUB' }],
    }).expect(201);
    expect(repeat.body.supplierId).toBe(supplierId);
    expect(await prisma.supplier.count({ where: { name: { contains: suffix } } })).toBe(2);

    await procurement.client.post(`${api}/tasks/${taskId}/supplier-offers`).send({
      supplierId, currency: 'EUR',
      items: [{ taskItemId: itemId, quantity: 1, unitPrice: 100, currency: 'RUB' }],
    }).expect(400);
  });

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

  it('enforces RBAC, magic-byte validation and versioned private downloads', async () => {
    const endpoint = `${api}/tasks/${taskId}/supplier-offers/${offerId}/documents`;
    await request(app.getHttpServer()).post(endpoint)
      .attach('file', pdf, { filename: 'offer.pdf', contentType: 'application/pdf' })
      .expect(401);
    await employee.client.post(endpoint)
      .attach('file', pdf, { filename: 'offer.pdf', contentType: 'application/pdf' })
      .expect(403);
    await procurement.client.post(endpoint)
      .attach('file', Buffer.from('not-a-pdf'), {
        filename: 'offer.pdf', contentType: 'application/pdf',
      }).expect(400);
    await procurement.client.post(endpoint)
      .attach('file', pdf, { filename: 'offer.jpg', contentType: 'application/pdf' })
      .expect(400);

    const document = await procurement.client.post(endpoint)
      .attach('file', pdf, { filename: 'offer.pdf', contentType: 'application/pdf' })
      .expect(201);
    documentId = document.body.id as string;
    expect(document.body.version).toBe(1);
    uploadedNames.push(document.body.storageName as string);
    const download = `${endpoint}/${documentId}`;
    await request(app.getHttpServer()).get(download).expect(401);
    await employee.client.get(download).expect(403);
    const retrieved = await procurement.client.get(download).expect(200);
    expect(retrieved.headers['content-disposition']).toContain('attachment');

    const wrongTask = randomUUID();
    await procurement.client.get(
      `${api}/tasks/${wrongTask}/supplier-offers/${offerId}/documents/${documentId}`,
    ).expect(404);
  });

  it('records immutable quote versions and rejects stale edits', async () => {
    const revision = await procurement.client.patch(
      `${api}/tasks/${taskId}/supplier-offers/${offerId}`,
    ).send({
      supplierId, currency: 'RUB',
      expectedVersion: 1,
      paymentTerms: 'Оплата после отгрузки',
      deliveryPrice: 25, deliveryDays: 10,
      items: [{ taskItemId: itemId, quantity: 2, unitPrice: 110, currency: 'RUB' }],
    }).expect(200);
    expect(revision.body.version).toBe(2);
    expect(revision.body.price).toBe('220');

    await procurement.client.patch(`${api}/tasks/${taskId}/supplier-offers/${offerId}`).send({
      supplierId, expectedVersion: 1,
      items: [{ taskItemId: itemId, quantity: 2, unitPrice: 115, currency: 'RUB' }],
    }).expect(409);

    const quote = await procurement.client.get(`${api}/tasks/${taskId}`).expect(200);
    const current = (quote.body.supplierOffers as Array<{
      id: string; documents: Array<{ id: string; version: number }>;
      revisions: Array<{ version: number; action: string }>;
    }>).find(x => x.id === offerId);
    expect(current?.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: documentId, version: 1 }),
    ]));
    expect(current?.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 1, action: 'CREATED' }),
      expect.objectContaining({ version: 2, action: 'UPDATED' }),
    ]));
  });

  it('requires manual selection reason and preserves quote → order → supplier history', async () => {
    const orderUrl = `${api}/tasks/${taskId}/supplier-offers/${offerId}/purchase-order`;
    const orderBody = {
      invoiceNumber: 'CORE06-INV',
      invoiceDate: new Date().toISOString(),
      items: [{ supplierOfferItemId: offerLineId, quantity: 2 }],
    };
    // Updating a quotation creates new line IDs; use the current version's line.
    const taskBefore = await procurement.client.get(`${api}/tasks/${taskId}`).expect(200);
    const current = (taskBefore.body.supplierOffers as Array<{
      id: string; items: Array<{ id: string }>;
    }>).find(x => x.id === offerId);
    const actualBody = { ...orderBody, items: [{
      supplierOfferItemId: current?.items[0].id, quantity: 2,
    }] };

    await procurement.client.post(orderUrl).send(actualBody).expect(409);
    await procurement.client.patch(
      `${api}/tasks/${taskId}/supplier-offers/${offerId}/decision`,
    ).send({ reason: 'ok' }).expect(400);
    const chosen = await procurement.client.patch(
      `${api}/tasks/${taskId}/supplier-offers/${offerId}/decision`,
    ).send({
      reason: 'Предложение соответствует техническому заданию, выбран согласованный срок',
    }).expect(200);
    expect(chosen.body.decisionReason).toContain('техническому');

    const order = await procurement.client.post(orderUrl).send(actualBody).expect(201);
    expect(order.body.supplierId).toBe(supplierId);
    await procurement.client.patch(`${api}/tasks/${taskId}/supplier-offers/${offerId}`).send({
      supplierId, currency: 'RUB',
      items: [{ taskItemId: itemId, quantity: 2, unitPrice: 120, currency: 'RUB' }],
    }).expect(409);

    const supplier = await procurement.client.get(`${api}/suppliers/${supplierId}`).expect(200);
    expect(supplier.body.purchaseOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: order.body.id, supplierOfferId: offerId }),
    ]));
    const state = await procurement.client.get(`${api}/tasks/${taskId}`).expect(200);
    expect(state.body.supplierOffers.find((x: { id: string }) => x.id === offerId).revisions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ action: 'SELECTED' })]));
  });
});
