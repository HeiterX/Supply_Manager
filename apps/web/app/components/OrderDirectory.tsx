'use client';

import Link from 'next/link';
import { formatDecimal, formatReportDate, statusLabels, taskLink, useDiscoveryList } from '../../lib/discovery';
import { DiscoveryControls, Pagination } from './DiscoveryControls';

type Order = {
  id: string; invoiceNumber: string | null; status: string; totalPrice: string | null;
  orderedAt: string; expectedDeliveryAt: string | null; paidAt: string | null; receivedAt: string | null;
  supplier: { id: string; name: string }; task: { id: string; number: number; title: string };
};

export default function OrderDirectory({ supplierId }: { supplierId?: string }) {
  const list = useDiscoveryList<Order>('orders', supplierId ? { supplierId } : undefined);
  const { data, loading, error } = list;
  const path = supplierId ? `/suppliers/${supplierId}` : '/orders';
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <DiscoveryControls entity="orders" {...list} total={data?.total} />
      {loading && <p role="status" className="p-5 text-sm text-slate-500">Загружаем заказы…</p>}
      {error && <p role="alert" className="p-5 text-sm text-rose-700">{error}</p>}
      {data?.items.length === 0 && <p className="p-5 text-sm text-slate-600">Заказов не найдено.</p>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {data.items.map((order) => (
            <li key={order.id} className="grid min-w-0 gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem] sm:p-5">
              <div className="min-w-0">
                <Link href={taskLink(order.task.id, path, list.query, 'order', order.id)}
                  className="break-words font-semibold text-blue-700 hover:underline">
                  {order.invoiceNumber ? `Счёт № ${order.invoiceNumber}` : `Заказ ${order.id}`}
                </Link>
                <div className="mt-1 break-words text-sm text-slate-600">Закупка № {order.task.number} · {order.task.title}</div>
              </div>
              <div className="min-w-0">
                {supplierId ? <span className="break-words">{order.supplier.name}</span>
                  : <Link href={`/suppliers/${order.supplier.id}`} className="break-words text-blue-700 hover:underline">{order.supplier.name}</Link>}
                <div className="mt-1 text-sm text-slate-600">{statusLabels[order.status] ?? order.status} · {formatDecimal(order.totalPrice, 'RUB')}</div>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-2 text-sm text-slate-600">
                <dt>Оформлен</dt><dd>{formatReportDate(order.orderedAt)}</dd>
                <dt>План доставки</dt><dd>{formatReportDate(order.expectedDeliveryAt)}</dd>
                <dt>Получен</dt><dd>{formatReportDate(order.receivedAt)}</dd>
                <dt>Оплачен</dt><dd>{formatReportDate(order.paidAt)}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data} onChange={list.setPage} />
    </section>
  );
}
