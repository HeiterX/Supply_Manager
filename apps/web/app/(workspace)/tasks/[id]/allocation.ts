import type { PurchaseOrder } from './ProcurementWorkspace';

export const milli = (value: string | number) => Math.round(Number(value) * 1000);

export function orderAllocation(orders: PurchaseOrder[]) {
  const result = new Map<string, { ordered: number; received: number; handed: number }>();
  for (const order of orders) {
    if (order.cancelledAt || order.status === 'CANCELLED') continue;
    for (const line of order.items ?? []) {
      if (!line.taskItemId) continue;
      const allocation = result.get(line.taskItemId) ?? { ordered: 0, received: 0, handed: 0 };
      const amount = milli(line.quantity);
      allocation.ordered += amount;
      if (order.receivedAt || order.status === 'RECEIVED' || order.status === 'HANDED_OVER') allocation.received += amount;
      if (order.status === 'HANDED_OVER') allocation.handed += amount;
      result.set(line.taskItemId, allocation);
    }
  }
  return result;
}
