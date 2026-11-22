'use client';
import AuthGate from '../components/AuthGate';
import Link from 'next/link';
import { Suspense } from 'react';
import { taskLink, useDiscoveryList } from '../../lib/discovery';
import { DiscoveryControls, Pagination } from '../components/DiscoveryControls';
import AppShell from '../components/AppShell';

type RegistrySupplier = {
  id: string;
  name: string;
};

type RegistryOffer = {
  id: string;
  supplier: RegistrySupplier;
};

type RegistryPurchaseOrder = {
  id: string;
  supplier: RegistrySupplier;
};

type RegistryTask = {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  deadline: string | null;
  nextAction: string | null;
  selectedOffer: RegistryOffer | null;
  purchaseOrder: RegistryPurchaseOrder | null;
};

type RegistryItem = {
  id: string;
  taskId: string;
  name: string;
  partNumber: string | null;
  quantity: string | number;
  unit: string;
  unitPrice: string | number | null;
  currency: string;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  task: RegistryTask;
};


const statusLabels: Record<string, string> = {
  NEW: 'Новая',
  SEARCHING: 'Поиск поставщика',
  NEGOTIATION: 'Переговоры',
  ORDERED: 'Заказано',
  WAITING_PAYMENT: 'Ожидает оплаты',
  WAITING_SHIPMENT: 'Ожидает отгрузки',
  IN_TRANSIT: 'В пути',
  READY_FOR_PICKUP: 'Готово к получению',
  RECEIVED: 'Получено',
  HANDED_OVER: 'Передано',
  CLOSED: 'Закрыто',
  CANCELLED: 'Отменено',
};

const statusTone: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  SEARCHING: 'bg-violet-50 text-violet-700',
  NEGOTIATION: 'bg-fuchsia-50 text-fuchsia-700',
  ORDERED: 'bg-indigo-50 text-indigo-700',
  WAITING_PAYMENT: 'bg-amber-50 text-amber-700',
  WAITING_SHIPMENT: 'bg-orange-50 text-orange-700',
  IN_TRANSIT: 'bg-blue-50 text-blue-700',
  READY_FOR_PICKUP: 'bg-cyan-50 text-cyan-700',
  RECEIVED: 'bg-emerald-50 text-emerald-700',
  HANDED_OVER: 'bg-teal-50 text-teal-700',
  CLOSED: 'bg-slate-100 text-slate-500',
  CANCELLED: 'bg-rose-50 text-rose-700',
};

function formatQuantity(value: string | number) {
  const number = Number(value);

  return Number.isFinite(number)
    ? new Intl.NumberFormat('ru-RU', {
        maximumFractionDigits: 3,
      }).format(number)
    : String(value);
}

function formatMoney(value: number, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function itemTotal(item: RegistryItem) {
  if (item.unitPrice === null) return null;

  const price = Number(item.unitPrice);
  const quantity = Number(item.quantity);

  return Number.isFinite(price) && Number.isFinite(quantity)
    ? price * quantity
    : null;
}

function itemSupplier(item: RegistryItem) {
  return (
    item.task.purchaseOrder?.supplier.name ??
    item.task.selectedOffer?.supplier.name ??
    '—'
  );
}

function RegistryContent() {
  const list = useDiscoveryList<RegistryItem>('items');
  const { data, loading, error: loadError, reload } = list;
  const filteredRegistry = data?.items ?? [];
  return (
    <AppShell
      title="Реестр позиций"
      subtitle="Все закупаемые позиции по всем закупкам"
      action={
        <Link
          href="/"
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          ← К закупкам
        </Link>
      }
    >
      {loadError && (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="self-start rounded-lg bg-white px-3 py-2 text-xs font-semibold text-rose-700 shadow-sm ring-1 ring-rose-200 sm:self-auto"
          >
            Повторить
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <DiscoveryControls entity="items" {...list} total={data?.total} />

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Загружаем реестр...
          </div>
        ) : loadError ? null : filteredRegistry.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Позиции не найдены.
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Позиция</th>
                    <th className="px-5 py-3">Количество</th>
                    <th className="px-5 py-3">Сумма</th>
                    <th className="px-5 py-3">Закупка</th>
                    <th className="px-5 py-3">Поставщик</th>
                    <th className="px-5 py-3">Статус</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredRegistry.map((item) => {
                    const total = itemTotal(item);

                    return (
                      <tr
                        key={item.id}
                        className="transition hover:bg-slate-50/60"
                      >
                        <td className="px-5 py-4">
                          <div className="font-semibold text-slate-900">
                            {item.name}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {item.partNumber || 'Без артикула'}
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {formatQuantity(item.quantity)} {item.unit}
                        </td>

                        <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-800">
                          {total === null
                            ? '—'
                            : formatMoney(
                                total,
                                item.currency || 'RUB',
                              )}
                        </td>

                        <td className="px-5 py-4">
                          <Link
                            href={taskLink(item.task.id, '/registry', list.query, 'items', item.id)}
                            className="font-medium text-slate-700 transition hover:text-blue-700"
                          >
                            №{item.task.number} · {item.task.title}
                          </Link>
                        </td>

                        <td className="px-5 py-4 text-slate-600">
                          {itemSupplier(item)}
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              statusTone[item.task.status] ??
                              'bg-slate-100'
                            }`}
                          >
                            {statusLabels[item.task.status] ??
                              item.task.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 md:hidden">
              {filteredRegistry.map((item) => {
                const total = itemTotal(item);

                return (
                  <Link
                    key={item.id}
                    href={taskLink(item.task.id, '/registry', list.query, 'items', item.id)}
                    className="block p-4 transition active:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">
                          {item.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {item.partNumber || 'Без артикула'}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold text-slate-800">
                          {total === null
                            ? '—'
                            : formatMoney(
                                total,
                                item.currency || 'RUB',
                              )}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {formatQuantity(item.quantity)} {item.unit}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-slate-500">
                        №{item.task.number} · {item.task.title}
                      </span>
                      <span className="shrink-0 text-slate-400">
                        {itemSupplier(item)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
        <Pagination page={data} onChange={list.setPage} />
      </section>
    </AppShell>
  );
}

export default function RegistryPage() {
  return (
    <AuthGate>
      <Suspense><RegistryContent /></Suspense>
    </AuthGate>
  );
}
