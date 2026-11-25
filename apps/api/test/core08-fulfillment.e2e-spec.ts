import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import type { FulfillmentDto } from '../src/tasks/dto/fulfillment.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

type Agent = Awaited<ReturnType<typeof createAuthenticatedAgent>>;
type CreatedOrder = { id: string; items: Array<{ id: string }> };
type FulfillmentCommand = Omit<FulfillmentDto, 'key'> & { key?: string };

const api = '/api/v1/tasks';
const requestApi = '/api/v1/purchase-requests';
const day = '2026-01-20';

describe('CORE-08 fulfillment through the procurement lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let procurement: Agent;
  let employee: Agent;
  let blocked: Agent;
  let taskId: string;
  let requestId: string;
  const supplierIds: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('CORE08_FINANCE_ENABLED', 'true');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    [admin, procurement, employee, blocked] = await Promise.all([
      createAuthenticatedAgent(app, prisma, 'ADMIN'),
      createAuthenticatedAgent(app, prisma, 'PROCUREMENT'),
      createAuthenticatedAgent(app, prisma, 'EMPLOYEE'),
      createAuthenticatedAgent(app, prisma, 'PROCUREMENT'),
    ]);
    await prisma.user.update({
      where: { id: blocked.userId },
      data: { status: 'BLOCKED' },
    });
  });

  afterAll(async () => {
    try {
      if (taskId) {
        const orders = { purchaseOrder: { taskId } };
        await prisma.fulfillmentOperation.deleteMany({ where: { taskId } });
        await prisma.fulfillmentEvent.deleteMany({
          where: { purchaseOrderItem: orders, kind: 'RESOLUTION' },
        });
        await prisma.fulfillmentEvent.deleteMany({
          where: { purchaseOrderItem: orders },
        });
        await prisma.shipmentItem.deleteMany({ where: { shipment: orders } });
        await prisma.shipment.deleteMany({ where: orders });
        await prisma.payment.deleteMany({ where: { invoice: orders } });
        await prisma.invoice.deleteMany({ where: orders });
        await prisma.task.update({
          where: { id: taskId },
          data: { selectedOfferId: null, currentPurchaseOrderId: null },
        });
        await prisma.task.delete({ where: { id: taskId } });
      }
      if (requestId)
        await prisma.purchaseRequest.deleteMany({ where: { id: requestId } });
      await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [admin, procurement, employee, blocked].flatMap((agent) =>
              agent ? [agent.userId] : [],
            ),
          },
        },
      });
    } finally {
      vi.unstubAllEnvs();
      await app?.close();
    }
  });

  function post(
    order: CreatedOrder,
    body: FulfillmentCommand,
    agent = procurement,
  ) {
    return agent.client
      .post(api + '/' + taskId + '/orders/' + order.id + '/fulfillment')
      .send({ key: randomUUID(), ...body });
  }

  async function makeOrder(
    itemId: string,
    quantity: number,
    unitPrice: number,
  ): Promise<CreatedOrder> {
    const offer = await procurement.client
      .post(api + '/' + taskId + '/supplier-offers')
      .send({
        supplierName: 'CORE08 synthetic ' + randomUUID(),
        currency: 'RUB',
        items: [{ taskItemId: itemId, quantity, unitPrice, currency: 'RUB' }],
      })
      .expect(201);
    const offerId = offer.body.id as string;
    supplierIds.push(offer.body.supplierId as string);
    await procurement.client
      .patch(api + '/' + taskId + '/supplier-offers/' + offerId + '/decision')
      .send({ reason: 'Синтетическое предложение для E2E' })
      .expect(200);
    const created = await procurement.client
      .post(
        api + '/' + taskId + '/supplier-offers/' + offerId + '/purchase-order',
      )
      .send({
        invoiceNumber: 'SYNTHETIC',
        invoiceDate: day,
        items: [
          { supplierOfferItemId: offer.body.items[0].id as string, quantity },
        ],
      })
      .expect(201);
    return created.body as CreatedOrder;
  }

  async function arrivedBatch(
    order: CreatedOrder,
    number: string,
    quantity: string,
  ) {
    const created = await post(order, {
      action: 'create-shipment',
      number,
      items: [{ itemId: order.items[0].id, quantity }],
    }).expect(201);
    const id = created.body.id as string;
    await post(order, {
      action: 'arrive-shipment',
      targetId: id,
      date: day,
    }).expect(409);
    await post(order, {
      action: 'dispatch-shipment',
      targetId: id,
      date: day,
      carrier: 'CORE08 carrier',
    }).expect(201);
    await post(order, {
      action: 'arrive-shipment',
      targetId: id,
      date: day,
    }).expect(201);
    const item = await prisma.shipmentItem.findFirstOrThrow({
      where: { shipmentId: id },
    });
    return { id, itemId: item.id };
  }

  it('records independent obligations, survives concurrent retries and closes after two suppliers', async () => {
    const submitted = await employee.client
      .post(requestApi)
      .send({
        title: 'CORE08 E2E',
        items: [{ name: 'Подшипник CORE08', quantity: 10, unit: 'шт.' }],
      })
      .expect(201);
    requestId = submitted.body.id as string;
    const accepted = await procurement.client
      .patch(requestApi + '/' + requestId + '/accept')
      .expect(200);
    taskId = accepted.body.task.id as string;
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { items: true },
    });
    const first = await makeOrder(task.items[0].id, 6, 0.05);
    const second = await makeOrder(task.items[0].id, 4, 1);
    const close = api + '/' + taskId + '/orders/close';
    const view = api + '/' + taskId + '/fulfillment';
    const firstPath = api + '/' + taskId + '/orders/' + first.id;
    const balance = () => procurement.client.get(view).expect(200);
    const bill = {
      action: 'create-invoice',
      amount: '0.30',
      currency: 'RUB',
      date: day,
      number: 'SYN-001',
    } as const;
    await request(app.getHttpServer()).get(view).expect(401);
    await employee.client.get(view).expect(403);
    const blockedResponse = await blocked.client.get(view);
    expect([401, 403]).toContain(blockedResponse.status);
    await post({ id: randomUUID(), items: [] }, bill).expect(404);
    await procurement.client.patch(firstPath + '/send-to-payment').expect(409);
    await post(first, { ...bill, amount: '-1' }).expect(400);
    await post(first, { ...bill, amount: '0' }).expect(400);
    await post(first, { ...bill, currency: 'USD' }).expect(400);
    await post(first, { ...bill, date: '2026-02-31' }).expect(400);
    const abandoned = await post(first, {
      ...bill,
      amount: '0.05',
      number: 'VOID',
    }).expect(201);
    await post(first, {
      action: 'edit-invoice',
      targetId: abandoned.body.id as string,
      amount: '0.06',
      number: 'VOID',
      currency: 'RUB',
      date: day,
    }).expect(201);
    await post(first, {
      action: 'cancel-invoice',
      targetId: abandoned.body.id as string,
      comment: 'Ошибочный черновик',
    }).expect(201);

    const invoice = await post(first, bill).expect(201);
    const invoiceId = invoice.body.id as string;
    await post(
      second,
      { action: 'approve-invoice', targetId: invoiceId },
      admin,
    ).expect(404);
    await post(
      first,
      { action: 'approve-invoice', targetId: invoiceId },
      employee,
    ).expect(403);
    await post(first, {
      action: 'approve-invoice',
      targetId: invoiceId,
    }).expect(403);
    await post(
      first,
      { action: 'approve-invoice', targetId: invoiceId },
      admin,
    ).expect(201);
    const payment = {
      action: 'register-payment',
      targetId: invoiceId,
      currency: 'RUB',
      date: day,
    } as const;
    await post(
      first,
      { ...payment, amount: '0', number: 'ZERO' },
      admin,
    ).expect(400);
    await post(
      first,
      { ...payment, amount: '0.31', number: 'OVER' },
      admin,
    ).expect(409);

    const batch = await arrivedBatch(first, 'LOT-A', '4');
    const receipt = {
      action: 'receive',
      targetId: batch.itemId,
      date: day,
      quantity: '3',
    } as const;
    const [payments, receipts] = await Promise.all([
      Promise.all(
        ['A', 'B'].map((number) =>
          post(first, { ...payment, amount: '0.20', number }, admin),
        ),
      ),
      Promise.all([post(first, receipt), post(first, receipt)]),
    ]);
    expect(
      payments
        .map((response) => response.status)
        .sort((left, right) => left - right),
    ).toEqual([201, 409]);
    expect(
      receipts
        .map((response) => response.status)
        .sort((left, right) => left - right),
    ).toEqual([201, 409]);
    const paid = payments.find((response) => response.status === 201);
    if (!paid) throw new Error('Expected one payment');
    await post(
      first,
      {
        action: 'cancel-payment',
        targetId: paid.body.id as string,
        comment: 'Сверка синтетического подтверждения',
      },
      admin,
    ).expect(201);
    const retry = {
      ...payment,
      amount: '0.10',
      number: 'RETRY',
      key: randomUUID(),
    };
    const recorded = await post(first, retry, admin).expect(201);
    const replay = await post(first, retry, admin).expect(201);
    expect(replay.body).toEqual({ id: recorded.body.id, replayed: true });
    await post(first, { ...retry, amount: '0.11' }, admin).expect(409);
    const state = await balance();
    expect(state.body.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          finance: {
            billed: '0.3',
            paid: '0.1',
            unsettled: '0.2',
            settled: false,
          },
        }),
      ]),
    );
    expect(state.body.positions[0]).toMatchObject({
      received: '3',
      accepted: '3',
      remaining: '10',
    });
    await procurement.client.patch(close).expect(409);
    await procurement.client
      .patch(firstPath + '/cancel')
      .send({ reason: 'Проверка истории' })
      .expect(409);

    const shortage = await post(first, {
      action: 'report-discrepancy',
      targetId: batch.itemId,
      quantity: '1',
      date: day,
      reason: 'SHORTAGE',
    }).expect(201);
    await post(first, {
      action: 'short-close-shipment',
      targetId: batch.id,
      comment: 'Замена отдельной партией',
    }).expect(201);
    await post(first, {
      action: 'return',
      targetId: batch.itemId,
      quantity: '4',
      date: day,
      comment: 'Тест переприёмки',
    }).expect(409);
    await post(first, {
      action: 'return',
      targetId: batch.itemId,
      quantity: '1',
      date: day,
      comment: 'Одна повреждённая единица',
    }).expect(201);
    const remainder = await arrivedBatch(first, 'LOT-B', '4');
    const nextReceipt = {
      ...receipt,
      targetId: remainder.itemId,
      quantity: '4',
      key: randomUUID(),
    };
    const finalReceipt = await post(first, nextReceipt).expect(201);
    const receiptReplay = await post(first, nextReceipt).expect(201);
    expect(receiptReplay.body.id).toBe(finalReceipt.body.id);
    await post(first, {
      action: 'handover',
      targetId: first.items[0].id,
      date: day,
      quantity: '6',
      comment: 'Исполнитель E2E',
    }).expect(201);
    await post(
      first,
      { ...payment, amount: '0.20', number: 'FINAL' },
      admin,
    ).expect(201);

    const secondBill = await post(second, {
      ...bill,
      amount: '4.00',
      number: 'SYN-002',
    }).expect(201);
    const secondBillId = secondBill.body.id as string;
    await post(
      second,
      { action: 'approve-invoice', targetId: secondBillId },
      admin,
    ).expect(201);
    await post(
      second,
      { ...payment, targetId: secondBillId, amount: '4.00', number: 'FIN-B' },
      admin,
    ).expect(201);
    const secondBatch = await arrivedBatch(second, 'LOT-C', '4');
    await post(second, {
      ...receipt,
      targetId: secondBatch.itemId,
      quantity: '4',
    }).expect(201);
    await post(second, {
      action: 'handover',
      targetId: second.items[0].id,
      date: day,
      quantity: '4',
      comment: 'Исполнитель E2E',
    }).expect(201);
    const blockedClose = await procurement.client.patch(close).expect(409);
    expect(blockedClose.body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: first.id,
          reason: expect.stringContaining('расхождения'),
        }),
      ]),
    );
    await post(first, {
      action: 'resolve-discrepancy',
      targetId: shortage.body.id as string,
      date: day,
      comment: 'Недопоставка и возврат восполнены',
    }).expect(201);
    const closing = await Promise.all([
      procurement.client.patch(close),
      procurement.client.patch(close),
    ]);
    expect(
      closing
        .map((response) => response.status)
        .sort((left, right) => left - right),
    ).toEqual([200, 409]);
    await post(second, bill).expect(409);
    await procurement.client
      .patch(api + '/' + taskId)
      .send({ priority: 'HIGH' })
      .expect(409);
    const final = await balance();
    expect(final.body.locked).toBe(true);
    expect(final.body.positions[0]).toMatchObject({
      ordered: '10',
      received: '11',
      returned: '1',
      accepted: '10',
      handedOver: '10',
      remaining: '0',
    });
    expect(
      (final.body.operations as Array<{ action: string }>).filter(
        (row) => row.action === 'close',
      ),
    ).toHaveLength(1);
  }, 45000);
});
