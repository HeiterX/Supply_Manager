import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

export async function seedDiscoveryBrowser(api) {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    url.searchParams.get('schema') !== 'e2e' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  ) {
    throw new Error(
      'Browser tests require a loopback DATABASE_URL with schema=e2e',
    );
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.href }, { schema: 'e2e' }),
  });
  const suffix = randomUUID().slice(0, 8);
  const marker = `CORE11-${suffix}`;
  const password = randomUUID();
  const users = [];
  const requestIds = [];
  let supplier;

  async function cleanup() {
    try {
      await db.task.deleteMany({ where: { title: { startsWith: marker } } });
      if (supplier) await db.supplier.delete({ where: { id: supplier.id } });
      await db.purchaseRequest.deleteMany({
        where: { id: { in: requestIds } },
      });
      await db.user.deleteMany({ where: { id: { in: users } } });
    } finally {
      await db.$disconnect();
    }
  }

  async function account(role) {
    const username = `core11_${role.toLowerCase()}_${suffix}`;
    const response = await fetch(`${api}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, fullName: `Browser ${role}` }),
    });
    if (!response.ok)
      throw new Error(`Cannot register fixture user: ${response.status}`);
    const { user } = await response.json();
    users.push(user.id);
    await db.user.update({
      where: { id: user.id },
      data: { role, status: 'ACTIVE' },
    });
    return { username, password, id: user.id };
  }

  try {
    const procurement = await account('PROCUREMENT');
    const employee = await account('EMPLOYEE');
    const createdAt = new Date('2025-02-01T12:00:00Z');
    const task = await db.task.create({
      data: {
        title: `${marker} Целевой криогенный датчик`,
        priority: 'HIGH',
        deadline: createdAt,
        createdAt,
      },
    });
    await db.task.createMany({
      data: Array.from({ length: 26 }, (_, i) => ({
        title: `${marker} Датчик ${i + 2}`,
        priority: 'HIGH',
        createdAt,
      })),
    });
    const taskItem = await db.taskItem.create({
      data: {
        taskId: task.id,
        name: 'Криогенный разъём',
        partNumber: `АРТ-${suffix}`,
        quantity: 2,
        unit: 'шт.',
      },
    });
    supplier = await db.supplier.create({
      data: { name: `${marker} Поставщик`, email: 'synthetic@example.invalid' },
    });
    const offer = await db.supplierOffer.create({
      data: { taskId: task.id, supplierId: supplier.id },
    });
    const order = await db.purchaseOrder.create({
      data: {
        taskId: task.id,
        supplierId: supplier.id,
        supplierOfferId: offer.id,
        invoiceNumber: `СЧ-${suffix}`,
        invoiceDate: createdAt,
        orderedAt: createdAt,
        createdAt,
        status: 'IN_TRANSIT',
        totalPrice: '200.25',
        items: {
          create: {
            taskItemId: taskItem.id,
            name: taskItem.name,
            partNumber: taskItem.partNumber,
            quantity: taskItem.quantity,
            unit: taskItem.unit,
            unitPrice: '100.12',
            currency: 'RUB',
          },
        },
      },
    });
    const own = await db.purchaseRequest.create({
      data: {
        title: `${marker} Моя заявка`,
        requesterId: employee.id,
        createdAt,
      },
    });
    requestIds.push(own.id);
    const other = await db.purchaseRequest.create({
      data: {
        title: `${marker} Чужая заявка`,
        requesterId: procurement.id,
        createdAt,
      },
    });
    requestIds.push(other.id);
    return {
      cleanup,
      marker,
      task,
      supplier,
      order,
      own,
      procurement,
      employee,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
