import { StatusBadge } from '@/app/components/StatusBadge';
import { Button, Card, EmptyState, TableRegion } from '@/app/components/ui';
import { workingDate } from '@/lib/working-list';
import type { PurchaseOrder } from './ProcurementWorkspace';

export function OrderTracking({ orders, mode, openOrders }: {
  orders: PurchaseOrder[]; mode: 'payments' | 'delivery'; openOrders: () => void;
}) {
  const payments = mode === 'payments';
  const title = payments ? 'Оплаты' : 'Доставка';
  return <section className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{title}</h2><Button variant="outline" onClick={openOrders}>К заказам</Button>
    </div>
    {!orders.length ? <EmptyState title={payments ? 'Счетов пока нет' : 'Заказов для отслеживания пока нет'} /> : <Card>
      <TableRegion label={title}>
        <table>
          <thead><tr>{(payments
            ? ['Поставщик / счёт', 'Сумма счёта', 'Статус', 'Передан на оплату', 'Оплачен']
            : ['Поставщик / счёт', 'Статус', 'Отгружен', 'Ожидается', 'Получен', 'Перевозчик / трек'])
            .map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{orders.map((order) => <tr key={order.id}>
            <th scope="row" className="min-w-40 text-left [overflow-wrap:anywhere]">
              {order.supplier.name}<p className="text-xs text-muted">{order.invoiceNumber ? `Счёт №${order.invoiceNumber}` : 'Счёт без номера'}</p>
            </th>
            {payments ? <>
              <td className="whitespace-nowrap tabular-nums">{order.totalPrice == null ? 'Не указано' : `${order.totalPrice.replace('.', ',')} ₽`}</td>
              <td>{order.cancelledAt || order.status === 'CANCELLED' ? 'Отменён'
                : order.paidAt ? 'Оплачен' : order.sentToPaymentAt ? 'Передан на оплату' : 'Ожидает передачи'}</td>
              <td>{workingDate(order.sentToPaymentAt)}</td><td>{workingDate(order.paidAt)}</td>
            </> : <>
              <td><StatusBadge status={order.status} /></td>
              <td>{workingDate(order.shippedAt)}</td><td>{workingDate(order.expectedDeliveryAt)}</td><td>{workingDate(order.receivedAt)}</td>
              <td className="min-w-32 [overflow-wrap:anywhere]">{[order.carrier, order.trackingNumber].filter(Boolean).join(' · ') || 'Не указано'}</td>
            </>}
          </tr>)}</tbody>
        </table>
      </TableRegion>
    </Card>}
  </section>;
}
