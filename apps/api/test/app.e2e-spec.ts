import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

describe('Purchase flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let taskId: string | undefined;
  const supplierIds: string[] = [];

  const api = '/api/v1';
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
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
    if (taskId) {
      await prisma.task.updateMany({
        where: { id: taskId },
        data: {
          selectedOfferId: null,
          currentPurchaseOrderId: null,
        },
      });

      await prisma.task.deleteMany({
        where: { id: taskId },
      });
    }

    for (const supplierId of supplierIds) {
      await prisma.supplier.deleteMany({
        where: { id: supplierId },
      });
    }

    if (app) {
      await app.close();
    }
  });

  it('проходит полный сценарий смены поставщика и защищает оплаченный заказ', async () => {
    const createTaskResponse = await request(app.getHttpServer())
      .post(`${api}/tasks`)
      .send({
        title: `E2E смена поставщика ${runId}`,
        description: 'Автоматический тест полного цикла закупки',
      })
      .expect(201);

    taskId = createTaskResponse.body.id;

    expect(taskId).toBeTruthy();
    expect(createTaskResponse.body.status).toBe('NEW');
    expect(createTaskResponse.body.selectedOfferId).toBeNull();
    expect(createTaskResponse.body.currentPurchaseOrderId).toBeNull();

    const supplierAResponse = await request(app.getHttpServer())
      .post(`${api}/tasks/${taskId}/supplier-offers`)
      .send({
        supplierName: `ООО E2E Поставщик А ${runId}`,
        contact: 'Иван',
        phone: '+7 900 111-11-11',
        email: `e2e-a-${runId}@example.com`,
        price: 100000,
        deliveryPrice: 5000,
        deliveryDays: 10,
        inStock: true,
        notes: 'Первый автоматический тестовый поставщик',
      })
      .expect(201);

    const offerAId = supplierAResponse.body.id as string;
    supplierIds.push(supplierAResponse.body.supplier.id as string);

    expect(offerAId).toBeTruthy();
    expect(supplierAResponse.body.status).toBe('OFFER_RECEIVED');

    const selectAResponse = await request(app.getHttpServer())
      .patch(`${api}/tasks/${taskId}/supplier-offers/${offerAId}/select`)
      .expect(200);

    expect(selectAResponse.body.status).toBe('NEGOTIATION');
    expect(selectAResponse.body.selectedOfferId).toBe(offerAId);
    expect(selectAResponse.body.currentPurchaseOrderId).toBeNull();

    const orderAResponse = await request(app.getHttpServer())
      .post(`${api}/tasks/${taskId}/purchase-order`)
      .send({
        invoiceNumber: `E2E-A-${runId}`,
        invoiceDate: new Date().toISOString(),
        notes: 'Автоматический тестовый счёт поставщика А',
      })
      .expect(201);

    const orderAId = orderAResponse.body.id as string;

    expect(orderAId).toBeTruthy();
    expect(orderAResponse.body.supplierOfferId).toBe(offerAId);
    expect(Number(orderAResponse.body.totalPrice)).toBe(105000);
    expect(orderAResponse.body.sentToPaymentAt).toBeNull();
    expect(orderAResponse.body.paidAt).toBeNull();
    expect(orderAResponse.body.cancelledAt).toBeNull();

    const taskAfterOrderA = await request(app.getHttpServer())
      .get(`${api}/tasks/${taskId}`)
      .expect(200);

    expect(taskAfterOrderA.body.status).toBe('ORDERED');
    expect(taskAfterOrderA.body.currentPurchaseOrderId).toBe(orderAId);
    expect(taskAfterOrderA.body.purchaseOrder.id).toBe(orderAId);

    const sendAResponse = await request(app.getHttpServer())
      .patch(`${api}/tasks/${taskId}/purchase-order/send-to-payment`)
      .expect(200);

    expect(sendAResponse.body.status).toBe('WAITING_PAYMENT');
    expect(sendAResponse.body.reminderAt).toBeTruthy();
    expect(sendAResponse.body.purchaseOrder.sentToPaymentAt).toBeTruthy();
    expect(sendAResponse.body.purchaseOrder.paidAt).toBeNull();

    const sentToPaymentAt = new Date(
      sendAResponse.body.purchaseOrder.sentToPaymentAt,
    ).getTime();
    const reminderAt = new Date(sendAResponse.body.reminderAt).getTime();

    expect(Math.abs(reminderAt - sentToPaymentAt - 24 * 60 * 60 * 1000))
      .toBeLessThanOrEqual(1000);

    const cancelReason = 'Поставщик изменил срок поставки';

    const cancelAResponse = await request(app.getHttpServer())
      .patch(`${api}/tasks/${taskId}/purchase-order/cancel`)
      .send({ reason: cancelReason })
      .expect(200);

    expect(cancelAResponse.body.status).toBe('SEARCHING');
    expect(cancelAResponse.body.selectedOfferId).toBeNull();
    expect(cancelAResponse.body.currentPurchaseOrderId).toBeNull();
    expect(cancelAResponse.body.purchaseOrder).toBeNull();
    expect(cancelAResponse.body.reminderAt).toBeNull();
    expect(cancelAResponse.body.nextAction).toBe('Выбрать нового поставщика');

    const cancelledOfferA = cancelAResponse.body.supplierOffers.find(
      (offer: { id: string }) => offer.id === offerAId,
    );
    expect(cancelledOfferA?.status).toBe('OFFER_RECEIVED');

    const cancelledOrderA = cancelAResponse.body.purchaseOrders.find(
      (order: { id: string }) => order.id === orderAId,
    );
    expect(cancelledOrderA).toBeTruthy();
    expect(cancelledOrderA.cancelledAt).toBeTruthy();
    expect(cancelledOrderA.cancelReason).toBe(cancelReason);
    expect(cancelledOrderA.paidAt).toBeNull();

    const supplierBResponse = await request(app.getHttpServer())
      .post(`${api}/tasks/${taskId}/supplier-offers`)
      .send({
        supplierName: `ООО E2E Поставщик Б ${runId}`,
        contact: 'Алексей',
        phone: '+7 900 222-22-22',
        email: `e2e-b-${runId}@example.com`,
        price: 97000,
        deliveryPrice: 4000,
        deliveryDays: 7,
        inStock: true,
        notes: 'Второй автоматический тестовый поставщик',
      })
      .expect(201);

    const offerBId = supplierBResponse.body.id as string;
    supplierIds.push(supplierBResponse.body.supplier.id as string);

    expect(offerBId).toBeTruthy();

    const selectBResponse = await request(app.getHttpServer())
      .patch(`${api}/tasks/${taskId}/supplier-offers/${offerBId}/select`)
      .expect(200);

    expect(selectBResponse.body.status).toBe('NEGOTIATION');
    expect(selectBResponse.body.selectedOfferId).toBe(offerBId);

    const orderBResponse = await request(app.getHttpServer())
      .post(`${api}/tasks/${taskId}/purchase-order`)
      .send({
        invoiceNumber: `E2E-B-${runId}`,
        invoiceDate: new Date().toISOString(),
        notes: 'Автоматический тестовый счёт поставщика Б',
      })
      .expect(201);

    const orderBId = orderBResponse.body.id as string;

    expect(orderBId).toBeTruthy();
    expect(orderBId).not.toBe(orderAId);
    expect(orderBResponse.body.supplierOfferId).toBe(offerBId);
    expect(Number(orderBResponse.body.totalPrice)).toBe(101000);

    const taskWithTwoOrders = await request(app.getHttpServer())
      .get(`${api}/tasks/${taskId}`)
      .expect(200);

    expect(taskWithTwoOrders.body.currentPurchaseOrderId).toBe(orderBId);
    expect(taskWithTwoOrders.body.purchaseOrder.id).toBe(orderBId);
    expect(taskWithTwoOrders.body.purchaseOrders).toHaveLength(2);

    const historyOrderA = taskWithTwoOrders.body.purchaseOrders.find(
      (order: { id: string }) => order.id === orderAId,
    );
    const historyOrderB = taskWithTwoOrders.body.purchaseOrders.find(
      (order: { id: string }) => order.id === orderBId,
    );

    expect(historyOrderA?.cancelledAt).toBeTruthy();
    expect(historyOrderA?.cancelReason).toBe(cancelReason);
    expect(historyOrderB?.cancelledAt).toBeNull();

    const sendBResponse = await request(app.getHttpServer())
      .patch(`${api}/tasks/${taskId}/purchase-order/send-to-payment`)
      .expect(200);

    expect(sendBResponse.body.status).toBe('WAITING_PAYMENT');
    expect(sendBResponse.body.reminderAt).toBeTruthy();

    const confirmPaymentResponse = await request(app.getHttpServer())
      .patch(`${api}/tasks/${taskId}/purchase-order/confirm-payment`)
      .expect(200);

    expect(confirmPaymentResponse.body.status).toBe('WAITING_SHIPMENT');
    expect(confirmPaymentResponse.body.reminderAt).toBeNull();
    expect(confirmPaymentResponse.body.purchaseOrder.id).toBe(orderBId);
    expect(confirmPaymentResponse.body.purchaseOrder.paidAt).toBeTruthy();

    const cancelPaidResponse = await request(app.getHttpServer())
      .patch(`${api}/tasks/${taskId}/purchase-order/cancel`)
      .send({ reason: 'Эта отмена должна быть запрещена' })
      .expect(409);

    expect(cancelPaidResponse.body.message).toBe(
      'Нельзя отменить выбор поставщика: оплата уже подтверждена',
    );

    const finalTaskResponse = await request(app.getHttpServer())
      .get(`${api}/tasks/${taskId}`)
      .expect(200);

    expect(finalTaskResponse.body.status).toBe('WAITING_SHIPMENT');
    expect(finalTaskResponse.body.currentPurchaseOrderId).toBe(orderBId);
    expect(finalTaskResponse.body.selectedOfferId).toBe(offerBId);
    expect(finalTaskResponse.body.purchaseOrder.id).toBe(orderBId);
    expect(finalTaskResponse.body.purchaseOrder.paidAt).toBeTruthy();
    expect(finalTaskResponse.body.purchaseOrders).toHaveLength(2);
  });
});
