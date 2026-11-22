import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAuthenticatedAgent } from './authenticated-agent.helper.js';

const url = '/api/v1/discovery';
const token = `CORE11-${randomUUID()}`;
const at = new Date('2024-07-31T21:00:00Z');
const before = new Date(at.getTime() - 1);
const dayAfter = new Date('2024-08-01T21:00:00Z');

describe('CORE-11 HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let procurement: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  let employee: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  const tasks: { id: string; number: number }[] = [];
  const supplierIds: string[] = [];
  const requestIds: string[] = [];

  beforeAll(async () => {
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
    db = app.get(PrismaService);
    procurement = await createAuthenticatedAgent(app, db, 'PROCUREMENT');
    employee = await createAuthenticatedAgent(app, db, 'EMPLOYEE');

    tasks.push(
      ...(await db.task.createManyAndReturn({
        data: [
          {
            title: `${token} КРИОГЕННЫЙ датчик 50%_А`,
            priority: 'HIGH',
            createdAt: at,
            deadline: at,
          },
          {
            title: `${token} криогенный датчик 50XXА`,
            priority: 'HIGH',
            createdAt: at,
            deadline: at,
          },
          {
            title: `${token} Отменена`,
            status: 'CANCELLED',
            createdAt: before,
            deadline: at,
          },
          {
            title: `${token} Завершена`,
            status: 'CLOSED',
            createdAt: before,
            closedAt: at,
          },
        ],
      })),
    );
    await db.taskItem.create({
      data: {
        taskId: tasks[0].id,
        name: `${token} Криогенный разъём`,
        partNumber: 'Артикул-005',
        quantity: '1.125',
        unit: 'шт.',
        currency: 'USD',
      },
    });
    requestIds.push(
      ...(
        await db.purchaseRequest.createManyAndReturn({
          data: [
            {
              title: `${token} моя Заявка`,
              requesterId: employee.userId,
              createdAt: at,
            },
            {
              title: `${token} скрытая Заявка`,
              requesterId: procurement.userId,
              createdAt: at,
            },
            {
              title: `${token} публичная Заявка`,
              requesterId: null,
              createdAt: dayAfter,
            },
          ],
        })
      ).map((row) => row.id),
    );
    for (const index of [0, 1]) {
      const supplier = await db.supplier.create({
        data: {
          name: `${token} Поставщик ${index}`,
          email: `mail${index}@example.invalid`,
        },
      });
      supplierIds.push(supplier.id);
      const offer = await db.supplierOffer.create({
        data: { taskId: tasks[0].id, supplierId: supplier.id },
      });
      await db.purchaseOrder.create({
        data: {
          taskId: tasks[0].id,
          supplierId: supplier.id,
          supplierOfferId: offer.id,
          orderedAt: at,
          createdAt: at,
          invoiceNumber: `Счёт-${index}`,
          invoiceDate: at,
          totalPrice: index === 0 ? '90000000000.11' : '0.19',
          status: index === 0 ? 'RECEIVED' : 'IN_TRANSIT',
          expectedDeliveryAt: at,
          paidAt: index === 0 ? at : null,
          receivedAt: index === 0 ? new Date(at.getTime() + 1000) : null,
        },
      });
      if (index === 0) {
        await db.purchaseOrder.create({
          data: {
            taskId: tasks[0].id,
            supplierId: supplier.id,
            supplierOfferId: offer.id,
            status: 'CANCELLED',
            orderedAt: at,
            createdAt: at,
            cancelledAt: at,
            invoiceNumber: 'Отменённый счёт',
            invoiceDate: at,
            totalPrice: '999.00',
          },
        });
      }
    }
  });

  afterAll(async () => {
    if (db) {
      await db.task.deleteMany({ where: { title: { contains: token } } });
      await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      await db.purchaseRequest.deleteMany({
        where: { id: { in: requestIds } },
      });
      await db.user.deleteMany({
        where: {
          id: { in: [procurement?.userId, employee?.userId].filter(Boolean) },
        },
      });
    }
    await app?.close();
  });

  it('requires JWT and applies employee ownership to search, counts, and exports', async () => {
    await request(app.getHttpServer()).get(`${url}/search`).expect(401);
    const own = await employee.client
      .get(`${url}/search`)
      .query({ q: token })
      .expect(200);
    expect(own.body).toMatchObject({
      total: 1,
      items: [{ entity: 'requests', id: requestIds[0] }],
    });
    const empty = await employee.client
      .get(`${url}/search`)
      .query({ q: '   ' })
      .expect(200);
    expect(empty.body).toMatchObject({ total: 0, items: [] });
    const list = await employee.client
      .get(`${url}/lists/requests`)
      .query({ q: token })
      .expect(200);
    expect(list.body).toMatchObject({
      total: 1,
      items: [{ id: requestIds[0] }],
    });
    await employee.client.get(`${url}/lists/tasks`).expect(403);
    await employee.client
      .get(`${url}/lists/orders/export?format=xlsx`)
      .expect(403);
    await employee.client.get(`${url}/suppliers/${supplierIds[0]}`).expect(403);
    await employee.client.get(`${url}/analytics`).expect(403);
    const csv = await employee.client
      .get(`${url}/lists/requests/export`)
      .query({ format: 'csv', q: token })
      .expect(200);
    expect(csv.text).toContain(`${token} моя Заявка`);
    expect(csv.text).not.toContain(`${token} скрытая Заявка`);
    expect(csv.text).not.toContain(`${token} публичная Заявка`);
    expect(csv.text).not.toContain('passwordHash');
  });

  it('searches Cyrillic names and references and treats SQL and LIKE syntax literally', async () => {
    const part = await procurement.client
      .get(`${url}/search`)
      .query({ q: 'АРТИКУЛ-005' })
      .expect(200);
    expect(part.body.items).toEqual([
      expect.objectContaining({ entity: 'items', reference: 'Артикул-005' }),
    ]);
    const cyrillic = await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ q: 'кРИОГЕННЫЙ датчик 50%_а' })
      .expect(200);
    expect(cyrillic.body).toMatchObject({
      total: 1,
      items: [{ id: tasks[0].id }],
    });
    const exact = await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ q: `#${tasks[0].number}` })
      .expect(200);
    expect(exact.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tasks[0].id })]),
    );
    const numeric = await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ q: String(tasks[0].number).slice(-1) })
      .expect(200);
    expect(numeric.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tasks[0].id })]),
    );
    const ordinaryText = await procurement.client
      .get(`${url}/search`)
      .query({ q: "' OR '1'='1" })
      .expect(200);
    expect(ordinaryText.body).toMatchObject({ total: 0, items: [] });
    const order = await procurement.client
      .get(`${url}/lists/orders`)
      .query({
        supplierId: supplierIds[1],
        payment: 'unpaid',
        status: 'IN_TRANSIT',
        overdue: 'true',
      })
      .expect(200);
    expect(order.body).toMatchObject({
      total: 1,
      items: [{ supplier: { id: supplierIds[1] } }],
    });
    const cancelled = await procurement.client
      .get(`${url}/lists/orders`)
      .query({ delivery: 'CANCELLED', payment: 'unpaid' })
      .expect(200);
    expect(cancelled.body).toMatchObject({ total: 0, items: [] });
  });

  it('composes filters, orders tied rows deterministically, and exports every filtered page', async () => {
    const q = {
      q: token,
      priority: 'HIGH',
      overdue: 'true',
      createdFrom: '2024-08-01',
      createdTo: '2024-08-01',
      sort: 'createdAt',
      pageSize: 1,
    };
    const first = await procurement.client
      .get(`${url}/lists/tasks`)
      .query(q)
      .expect(200);
    const second = await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ ...q, page: 2 })
      .expect(200);
    const [id1, id2] = [tasks[0].id, tasks[1].id].sort();
    expect(first.body).toMatchObject({
      total: 2,
      hasPrevious: false,
      hasNext: true,
      items: [{ id: id1 }],
    });
    expect(second.body).toMatchObject({
      total: 2,
      hasPrevious: true,
      hasNext: false,
      items: [{ id: id2 }],
    });
    const hasOrders = await procurement.client
      .get(`${url}/lists/tasks`)
      .query({
        ...q,
        hasOrders: 'true',
        delivery: 'IN_TRANSIT',
        payment: 'unpaid',
      })
      .expect(200);
    expect(hasOrders.body).toMatchObject({
      total: 1,
      items: [{ id: tasks[0].id }],
    });
    const csv = await procurement.client
      .get(`${url}/lists/tasks/export`)
      .query({ ...q, format: 'csv', page: 2 })
      .expect(200);
    expect(csv.headers['content-disposition']).toContain(
      'supply-manager-tasks-',
    );
    expect(csv.text).toContain('2024-08-01 00:00:00');
    expect(csv.text.indexOf(`"${first.body.items[0].title}"`)).toBeLessThan(
      csv.text.indexOf(`"${second.body.items[0].title}"`),
    );
    await procurement.client
      .get(`${url}/lists/tasks/export`)
      .query({ ...q, format: 'xlsx' })
      .expect('Content-Type', /spreadsheetml/)
      .expect(200);
    await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ pageSize: 101 })
      .expect(400);
    await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ sort: 'passwordHash' })
      .expect(400);
    await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ createdFrom: '2025-02-29' })
      .expect(400);
    await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ status: 'INVALID' })
      .expect(400);
    await procurement.client
      .get(`${url}/search`)
      .query({ q: '\u0000x' })
      .expect(400);
  });

  it('aggregates order events per date and supplier without double-counting a purchase', async () => {
    const query = { from: '2024-08-01', to: '2024-08-01' };
    const report = await procurement.client
      .get(`${url}/analytics`)
      .query(query)
      .expect(200);
    expect(report.body).toMatchObject({
      timeZone: 'Europe/Moscow',
      period: { requests: 2, orders: 3, received: 1, overdueOrders: 1 },
      payments: {
        currency: 'RUB',
        invoiced: '90000000000.30',
        paid: '90000000000.11',
        outstanding: '0.19',
      },
      monthly: [
        {
          month: '2024-08',
          created: 2,
          closed: 1,
          invoices: '90000000000.30',
          paid: '90000000000.11',
        },
      ],
      suppliers: expect.arrayContaining([
        expect.objectContaining({
          id: supplierIds[0],
          orders: 1,
          received: 1,
          assessed: 1,
          late: 1,
        }),
        expect.objectContaining({
          id: supplierIds[1],
          orders: 1,
          received: 0,
          assessed: 0,
          late: 0,
        }),
      ]),
    });
    expect(report.body.snapshot.awaitingDelivery).toBeGreaterThanOrEqual(1);
    expect(report.body.overduePurchases).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tasks[0].id })]),
    );
    const empty = await procurement.client
      .get(`${url}/analytics`)
      .query({ from: '2023-01-01', to: '2023-01-01' })
      .expect(200);
    expect(empty.body).toMatchObject({
      monthly: [],
      deliveryStatuses: [],
      suppliers: [],
      period: { orders: 0 },
    });
    const exported = await procurement.client
      .get(`${url}/analytics/export`)
      .query({ ...query, format: 'csv' })
      .expect(200);
    expect(exported.text).toContain('90000000000,30;"RUB"');
    expect(exported.text).not.toContain('"USD"');
    const positions = await procurement.client
      .get(`${url}/lists/items/export`)
      .query({ q: 'Артикул-005', format: 'csv' })
      .expect(200);
    expect(positions.text).toContain('1,125;"шт.";;"USD"');
  });

  it('rejects oversized exports without affecting list pagination', async () => {
    const title = `${token} bulk`;
    await db.task.createMany({
      data: Array.from({ length: 2001 }, () => ({ title })),
    });
    const list = await procurement.client
      .get(`${url}/lists/tasks`)
      .query({ q: title, page: 2, pageSize: 100 })
      .expect(200);
    expect(list.body.total).toBe(2001);
    expect(list.body.items).toHaveLength(100);
    await procurement.client
      .get(`${url}/lists/tasks/export`)
      .query({ q: title, format: 'csv' })
      .expect(413);
  });
});
