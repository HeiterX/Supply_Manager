import 'dotenv/config';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Multi-supplier procurement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tasks: string[] = [];
  const suppliers: string[] = [];
  const api = '/api/v1/tasks';
  const http = () => app.getHttpServer();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const id of tasks) {
      await prisma.task.updateMany({ where: { id }, data: { currentPurchaseOrderId: null, selectedOfferId: null } });
      await prisma.task.deleteMany({ where: { id } });
    }
    for (const id of suppliers) await prisma.supplier.deleteMany({ where: { id } });
    await app.close();
  });

  async function createTask() {
    const res = await request(http()).post(api).send({ title: `E2E multi ${Date.now()}` }).expect(201);
    tasks.push(res.body.id);
    return res.body.id as string;
  }
  async function addItem(taskId: string, name: string, quantity: number) {
    const res = await request(http()).post(`${api}/${taskId}/items`).send({ name, quantity, unit: 'шт.' }).expect(201);
    return res.body.id as string;
  }
  async function addOffer(taskId: string, name: string, items: Array<{ taskItemId: string; quantity: number; unitPrice: number }>) {
    const res = await request(http()).post(`${api}/${taskId}/supplier-offers`).send({ supplierName: name, deliveryPrice: 100, items }).expect(201);
    suppliers.push(res.body.supplier.id);
    return res.body as { id: string; items: Array<{ id: string; taskItemId: string }> };
  }
  function order(taskId: string, offer: { id: string; items: Array<{ id: string; taskItemId: string }> }, quantities: Record<string, number>, invoice: string) {
    return request(http()).post(`${api}/${taskId}/supplier-offers/${offer.id}/purchase-order`).send({
      invoiceNumber: invoice, invoiceDate: new Date().toISOString(),
      items: offer.items.map(item => ({ supplierOfferItemId: item.id, quantity: quantities[item.taskItemId] })),
    });
  }
  function action(taskId: string, orderId: string, name: string, body = {}) {
    return request(http()).patch(`${api}/${taskId}/orders/${orderId}/${name}`).send(body);
  }

  it('allocates partial quantities, blocks over-ordering and closes only after all handovers', async () => {
    const taskId = await createTask();
    const bearing = await addItem(taskId, 'Подшипник', 10);
    const gasket = await addItem(taskId, 'Прокладка', 20);
    const a = await addOffer(taskId, 'Поставщик А', [
      { taskItemId: bearing, quantity: 6, unitPrice: 1000 },
      { taskItemId: gasket, quantity: 20, unitPrice: 50 },
    ]);
    const b = await addOffer(taskId, 'Поставщик Б', [{ taskItemId: bearing, quantity: 4, unitPrice: 1100 }]);
    const c = await addOffer(taskId, 'Поставщик В', [{ taskItemId: bearing, quantity: 1, unitPrice: 1200 }]);
    // A quote can be corrected before ordering, but never after it has been used.
    const edited = await request(http()).patch(`${api}/${taskId}/supplier-offers/${c.id}`).send({
      supplierName: 'Поставщик В', items: [{ taskItemId: bearing, quantity: 1, unitPrice: 1250 }],
    }).expect(200);
    c.items = edited.body.items;
    const resA = await order(taskId, a, { [bearing]: 6, [gasket]: 20 }, 'A-1').expect(201);
    const resB = await order(taskId, b, { [bearing]: 4 }, 'B-1').expect(201);
    const idA = resA.body.id as string;
    const idB = resB.body.id as string;
    expect(resA.body.items).toHaveLength(2);
    expect(resB.body.items).toHaveLength(1);
    await order(taskId, c, { [bearing]: 1 }, 'C-1').expect(409);
    await order(taskId, a, { [bearing]: 6, [gasket]: 20 }, 'A-2').expect(409);
    await request(http()).patch(`${api}/${taskId}/supplier-offers/${a.id}`).send({
      supplierName: 'Поставщик А', items: [{ taskItemId: bearing, quantity: 6, unitPrice: 900 }],
    }).expect(409);
    await request(http()).patch(`${api}/${taskId}/items/${bearing}`).send({ quantity: 20 }).expect(409);
    await request(http()).delete(`${api}/${taskId}/items/${bearing}`).expect(409);
    await request(http()).patch(`${api}/${taskId}/purchase-order/close`).expect(409);
    await request(http()).patch(`${api}/${taskId}/orders/close`).expect(409);

    for (const id of [idA, idB]) {
      await action(taskId, id, 'send-to-payment').expect(200);
      await action(taskId, id, 'confirm-payment').expect(200);
      await action(taskId, id, 'ship', { shippedAt: new Date().toISOString(), carrier: 'ТК Тест' }).expect(200);
      await action(taskId, id, 'ready-for-pickup').expect(200);
      await action(taskId, id, 'receive').expect(200);
      await action(taskId, id, 'hand-over', { handedOverTo: 'Иванов И.И.' }).expect(200);
      if (id === idA) await request(http()).patch(`${api}/${taskId}/orders/close`).expect(409);
    }
    const state = await request(http()).get(`${api}/${taskId}`).expect(200);
    expect(state.body.purchaseOrders).toHaveLength(2);
    expect(state.body.status).toBe('HANDED_OVER');
    expect(state.body.activities.some((a: { text: string }) => a.text === 'Товар передан: Иванов И.И.')).toBe(true);
    await request(http()).patch(`${api}/${taskId}/orders/close`).expect(200);
    const closed = await request(http()).get(`${api}/${taskId}`).expect(200);
    expect(closed.body.status).toBe('CLOSED');
  });

  it('cancellation releases reserved quantity for a replacement supplier', async () => {
    const taskId = await createTask();
    const itemId = await addItem(taskId, 'Фильтр', 10);
    const a = await addOffer(taskId, 'Отменённый поставщик', [{ taskItemId: itemId, quantity: 10, unitPrice: 10 }]);
    const b = await addOffer(taskId, 'Новый поставщик', [{ taskItemId: itemId, quantity: 10, unitPrice: 11 }]);
    const res = await order(taskId, a, { [itemId]: 10 }, 'OLD').expect(201);
    await action(taskId, res.body.id, 'cancel', { reason: 'Нет товара' }).expect(200);
    const replacement = await order(taskId, b, { [itemId]: 10 }, 'NEW').expect(201);
    expect(replacement.body.items).toHaveLength(1);
    const state = await request(http()).get(`${api}/${taskId}`).expect(200);
    expect(state.body.purchaseOrders).toHaveLength(2);
    expect(state.body.purchaseOrders.filter((o: { cancelledAt: string | null }) => !o.cancelledAt)).toHaveLength(1);
    await action(taskId, replacement.body.id, 'send-to-payment').expect(200);
    await action(taskId, replacement.body.id, 'confirm-payment').expect(200);
    await action(taskId, replacement.body.id, 'cancel', { reason: 'Поздно' }).expect(409);
  });
});
