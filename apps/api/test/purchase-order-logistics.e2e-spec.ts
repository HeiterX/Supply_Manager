import 'dotenv/config';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

describe('Purchase order logistics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let client: ReturnType<typeof request.agent>;
  let authUserId = '';

  let taskId = '';
  let supplierId = '';

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
    const auth = await createAuthenticatedAgent(app, prisma, 'PROCUREMENT');
    client = auth.client;
    authUserId = auth.userId;
  });

  afterAll(async () => {
    if (taskId) {
      await prisma.task
        .delete({ where: { id: taskId } })
        .catch(() => undefined);
    }

    if (supplierId) {
      await prisma.supplier
        .delete({ where: { id: supplierId } })
        .catch(() => undefined);
    }

    if (authUserId) {
      await prisma.user.deleteMany({ where: { id: authUserId } });
    }

    await app.close();
  });

  it('moves paid order through the logistics flow to CLOSED', async () => {
    /*
     * 1. Создаём закупку
     */
    const taskResponse = await client
      .post('/api/v1/tasks')
      .send({
        title: `E2E logistics ${Date.now()}`,
        priority: 'NORMAL',
      })
      .expect(201);

    taskId = taskResponse.body.id as string;

    /*
     * Нельзя вручную перескочить сразу в CLOSED
     * через обычное редактирование задачи.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}`)
      .send({
        status: 'CLOSED',
      })
      .expect(400);

    /*
     * 2. Добавляем предложение поставщика
     */
    const offerResponse = await client
      .post(`/api/v1/tasks/${taskId}/supplier-offers`)
      .send({
        supplierName: `E2E Logistics Supplier ${Date.now()}`,
        price: 10000,
        deliveryPrice: 1000,
        deliveryDays: 3,
        inStock: true,
      })
      .expect(201);

    const offerId = offerResponse.body.id as string;
    supplierId = offerResponse.body.supplier.id as string;

    /*
     * 3. Выбираем предложение
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/supplier-offers/${offerId}/select`)
      .expect(200);

    /*
     * 4. Оформляем заказ
     */
    await client
      .post(`/api/v1/tasks/${taskId}/purchase-order`)
      .send({
        invoiceNumber: 'E2E-LOG-001',
        invoiceDate: new Date().toISOString(),
      })
      .expect(201);

    /*
     * Нельзя закрыть закупку до передачи товара.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/close`)
      .expect(400);

    /*
     * До прохождения логистических этапов нельзя:
     * - отметить прибытие;
     * - подтвердить получение;
     * - передать товар.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/ready-for-pickup`)
      .expect(400);

    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/receive`)
      .expect(400);

    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/hand-over`)
      .send({
        handedOverTo: 'Механик Иванов И.И.',
      })
      .expect(400);

    /*
     * 5. Передаём счёт на оплату
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/send-to-payment`)
      .expect(200);

    /*
     * 6. Подтверждаем оплату
     */
    const paidResponse = await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/confirm-payment`)
      .expect(200);

    expect(paidResponse.body.status).toBe('WAITING_SHIPMENT');
    expect(paidResponse.body.purchaseOrder.paidAt).toBeTruthy();

    /*
     * 7. Отгружаем товар
     */
    const shippedAt = new Date();

    const expectedDeliveryAt = new Date(
      shippedAt.getTime() + 3 * 24 * 60 * 60 * 1000,
    );

    const shipResponse = await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/ship`)
      .send({
        shippedAt: shippedAt.toISOString(),
        carrier: 'ПЭК',
        trackingNumber: 'E2E-TTN-123',
        expectedDeliveryAt: expectedDeliveryAt.toISOString(),
      })
      .expect(200);

    expect(shipResponse.body.status).toBe('IN_TRANSIT');
    expect(shipResponse.body.nextAction).toContain('ПЭК');
    expect(shipResponse.body.nextAction).toContain('E2E-TTN-123');

    expect(shipResponse.body.purchaseOrder.shippedAt).toBeTruthy();
    expect(shipResponse.body.purchaseOrder.carrier).toBe('ПЭК');
    expect(shipResponse.body.purchaseOrder.trackingNumber).toBe(
      'E2E-TTN-123',
    );
    expect(
      shipResponse.body.purchaseOrder.expectedDeliveryAt,
    ).toBeTruthy();

    expect(shipResponse.body.reminderAt).toBeTruthy();

    const shippingHistoryTexts = (
      shipResponse.body.activities as Array<{ text: string }>
    )
      .map((activity) => activity.text)
      .join('\n');

    expect(shippingHistoryTexts).toContain(
      'Заказ отгружен поставщиком',
    );
    expect(shippingHistoryTexts).toContain('ПЭК');
    expect(shippingHistoryTexts).toContain('E2E-TTN-123');

    /*
     * Пока груз находится в пути,
     * подтвердить получение нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/receive`)
      .expect(400);

    /*
     * И передать его тоже нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/hand-over`)
      .send({
        handedOverTo: 'Механик Иванов И.И.',
      })
      .expect(400);

    /*
     * Закрыть закупку в пути тоже нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/close`)
      .expect(400);

    /*
     * 8. Груз прибывает
     */
    const readyResponse = await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/ready-for-pickup`)
      .expect(200);

    expect(readyResponse.body.status).toBe('READY_FOR_PICKUP');
    expect(readyResponse.body.nextAction).toBe('Получить товар');
    expect(readyResponse.body.reminderAt).toBeNull();

    expect(
      readyResponse.body.purchaseOrder.readyForPickupAt,
    ).toBeTruthy();

    /*
     * Предыдущая логистика сохраняется.
     */
    expect(readyResponse.body.purchaseOrder.shippedAt).toBeTruthy();
    expect(readyResponse.body.purchaseOrder.carrier).toBe('ПЭК');
    expect(readyResponse.body.purchaseOrder.trackingNumber).toBe(
      'E2E-TTN-123',
    );

    const readyHistoryTexts = (
      readyResponse.body.activities as Array<{ text: string }>
    )
      .map((activity) => activity.text)
      .join('\n');

    expect(readyHistoryTexts).toContain(
      'Груз прибыл и готов к получению',
    );

    /*
     * Повторно отметить прибытие нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/ready-for-pickup`)
      .expect(409);

    /*
     * Товар ещё не получен — передавать его нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/hand-over`)
      .send({
        handedOverTo: 'Механик Иванов И.И.',
      })
      .expect(400);

    /*
     * Закрывать закупку тоже ещё нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/close`)
      .expect(400);

    /*
     * 9. Получаем товар
     */
    const receiveResponse = await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/receive`)
      .expect(200);

    expect(receiveResponse.body.status).toBe('RECEIVED');

    expect(receiveResponse.body.nextAction).toBe(
      'Передать товар конечному получателю',
    );

    expect(receiveResponse.body.reminderAt).toBeNull();
    expect(receiveResponse.body.purchaseOrder.receivedAt).toBeTruthy();

    /*
     * Вся предыдущая логистика должна сохраниться.
     */
    expect(
      receiveResponse.body.purchaseOrder.readyForPickupAt,
    ).toBeTruthy();
    expect(receiveResponse.body.purchaseOrder.shippedAt).toBeTruthy();
    expect(receiveResponse.body.purchaseOrder.carrier).toBe('ПЭК');
    expect(receiveResponse.body.purchaseOrder.trackingNumber).toBe(
      'E2E-TTN-123',
    );

    const receiveHistoryTexts = (
      receiveResponse.body.activities as Array<{ text: string }>
    )
      .map((activity) => activity.text)
      .join('\n');

    expect(receiveHistoryTexts).toContain('Товар получен');

    /*
     * Повторно получить товар нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/receive`)
      .expect(409);

    /*
     * Пока товар не передан конечному получателю,
     * закупку закрыть нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/close`)
      .expect(400);

    /*
     * Пустой получатель должен отклоняться ValidationPipe.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/hand-over`)
      .send({
        handedOverTo: '',
      })
      .expect(400);

    /*
     * 10. Передаём товар конечному получателю
     */
    const handOverResponse = await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/hand-over`)
      .send({
        handedOverTo: 'Механик Иванов И.И.',
      })
      .expect(200);

    expect(handOverResponse.body.status).toBe('HANDED_OVER');
    expect(handOverResponse.body.nextAction).toBe('Закрыть закупку');
    expect(handOverResponse.body.reminderAt).toBeNull();

    expect(
      handOverResponse.body.purchaseOrder.handedOverAt,
    ).toBeTruthy();

    expect(
      handOverResponse.body.purchaseOrder.handedOverTo,
    ).toBe('Механик Иванов И.И.');

    /*
     * Проверяем, что весь логистический след сохранился.
     */
    expect(handOverResponse.body.purchaseOrder.paidAt).toBeTruthy();
    expect(handOverResponse.body.purchaseOrder.shippedAt).toBeTruthy();
    expect(
      handOverResponse.body.purchaseOrder.readyForPickupAt,
    ).toBeTruthy();
    expect(handOverResponse.body.purchaseOrder.receivedAt).toBeTruthy();

    expect(handOverResponse.body.purchaseOrder.carrier).toBe('ПЭК');
    expect(
      handOverResponse.body.purchaseOrder.trackingNumber,
    ).toBe('E2E-TTN-123');

    const handOverHistoryTexts = (
      handOverResponse.body.activities as Array<{ text: string }>
    )
      .map((activity) => activity.text)
      .join('\n');

    expect(handOverHistoryTexts).toContain(
      'Товар передан: Механик Иванов И.И.',
    );

    /*
     * 11. Повторная передача запрещена.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/hand-over`)
      .send({
        handedOverTo: 'Другой получатель',
      })
      .expect(409);

    /*
     * 12. Закрываем закупку.
     */
    const closeResponse = await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/close`)
      .expect(200);

    expect(closeResponse.body.status).toBe('CLOSED');
    expect(closeResponse.body.closedAt).toBeTruthy();
    expect(closeResponse.body.nextAction).toBeNull();
    expect(closeResponse.body.reminderAt).toBeNull();

    /*
     * После закрытия весь логистический след
     * должен остаться в системе.
     */
    expect(closeResponse.body.purchaseOrder.paidAt).toBeTruthy();
    expect(closeResponse.body.purchaseOrder.shippedAt).toBeTruthy();

    expect(
      closeResponse.body.purchaseOrder.readyForPickupAt,
    ).toBeTruthy();

    expect(closeResponse.body.purchaseOrder.receivedAt).toBeTruthy();

    expect(
      closeResponse.body.purchaseOrder.handedOverAt,
    ).toBeTruthy();

    expect(
      closeResponse.body.purchaseOrder.handedOverTo,
    ).toBe('Механик Иванов И.И.');

    expect(closeResponse.body.purchaseOrder.carrier).toBe('ПЭК');

    expect(
      closeResponse.body.purchaseOrder.trackingNumber,
    ).toBe('E2E-TTN-123');

    const closeHistoryTexts = (
      closeResponse.body.activities as Array<{ text: string }>
    )
      .map((activity) => activity.text)
      .join('\n');

    expect(closeHistoryTexts).toContain('Закупка закрыта');

    /*
     * 13. Повторно закрыть закупку нельзя.
     */
    await client
      .patch(`/api/v1/tasks/${taskId}/purchase-order/close`)
      .expect(409);
  });

  it('rejects shipping before payment confirmation', async () => {
    const taskResponse = await client
      .post('/api/v1/tasks')
      .send({
        title: `E2E logistics invalid ${Date.now()}`,
        priority: 'NORMAL',
      })
      .expect(201);

    const invalidTaskId = taskResponse.body.id as string;

    let invalidSupplierId = '';

    try {
      const offerResponse = await client
        .post(`/api/v1/tasks/${invalidTaskId}/supplier-offers`)
        .send({
          supplierName: `E2E Invalid Supplier ${Date.now()}`,
          price: 5000,
          deliveryPrice: 500,
          deliveryDays: 2,
          inStock: true,
        })
        .expect(201);

      const offerId = offerResponse.body.id as string;
      invalidSupplierId = offerResponse.body.supplier.id as string;

      await client
        .patch(
          `/api/v1/tasks/${invalidTaskId}/supplier-offers/${offerId}/select`,
        )
        .expect(200);

      await client
        .post(`/api/v1/tasks/${invalidTaskId}/purchase-order`)
        .send({
          invoiceNumber: 'E2E-LOG-INVALID',
          invoiceDate: new Date().toISOString(),
        })
        .expect(201);

      /*
       * Нельзя отметить заказ отгруженным,
       * пока оплата не подтверждена.
       */
      await client
        .patch(`/api/v1/tasks/${invalidTaskId}/purchase-order/ship`)
        .send({
          shippedAt: new Date().toISOString(),
          carrier: 'СДЭК',
        })
        .expect(400);

      /*
       * И тем более нельзя закрыть такую закупку.
       */
      await client
        .patch(`/api/v1/tasks/${invalidTaskId}/purchase-order/close`)
        .expect(400);
    } finally {
      await prisma.task
        .delete({ where: { id: invalidTaskId } })
        .catch(() => undefined);

      if (invalidSupplierId) {
        await prisma.supplier
          .delete({ where: { id: invalidSupplierId } })
          .catch(() => undefined);
      }
    }
  });
});