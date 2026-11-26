import type { Prisma } from '../generated/prisma/client.js';

// Called only in the same transaction that closes/cancels a procurement task.
// Delivery leases already in progress cannot be unsent; pending notices are revoked.
export async function cancelTaskActions(tx: Prisma.TransactionClient, taskId: string, actorId?: string) {
  const active = await tx.nextAction.findMany({ where: { taskId, status: 'ACTIVE' }, select: { id: true } });
  for (const row of active) {
    const changed = await tx.nextAction.updateMany({
      where: { id: row.id, status: 'ACTIVE' }, data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    if (!changed.count) continue;
    await tx.nextActionHistory.create({
      data: { actionId: row.id, actorId: actorId ?? null, type: 'CANCELLED', comment: 'Закупка завершена' },
    });
    await tx.telegramDelivery.updateMany({
      where: { eventKey: { startsWith: 'core09:' + row.id + ':' }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }
}
