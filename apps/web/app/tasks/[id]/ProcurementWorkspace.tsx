'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';

export type Supplier = {
  id: string; name: string; contact: string | null; phone: string | null;
  email: string | null; website: string | null; notes: string | null;
};
export type TaskItem = {
  id: string; taskId: string; name: string; partNumber: string | null;
  quantity: string | number; unit: string; unitPrice: string | number | null;
  currency: string; notes: string | null; sortOrder: number;
  createdAt: string; updatedAt: string;
};
export type SupplierOfferItem = {
  id: string; supplierOfferId: string; taskItemId: string;
  quantity: string | number; unitPrice: string | number | null;
  currency: string; inStock: boolean | null; notes: string | null;
  taskItem: TaskItem;
};
export type SupplierOffer = {
  id: string; status: string; price: string | null; deliveryPrice: string | null;
  deliveryDays: number | null; inStock: boolean | null; notes: string | null;
  requestedAt: string; receivedAt: string | null; supplier: Supplier;
  items: SupplierOfferItem[];
};
export type PurchaseOrderItem = {
  id: string; taskItemId: string | null; supplierOfferItemId: string | null;
  name: string; partNumber: string | null; quantity: string | number;
  unit: string; unitPrice: string | number | null; currency: string; notes: string | null;
};
export type PurchaseOrder = {
  id: string; taskId: string; supplierId: string; supplierOfferId: string; status: string;
  price: string | null; deliveryPrice: string | null; totalPrice: string | null;
  deliveryDays: number | null; invoiceNumber: string | null; invoiceDate: string | null;
  notes: string | null; orderedAt: string; sentToPaymentAt: string | null;
  paidAt: string | null; shippedAt: string | null; carrier: string | null;
  trackingNumber: string | null; expectedDeliveryAt: string | null;
  readyForPickupAt: string | null; receivedAt: string | null;
  handedOverAt: string | null; handedOverTo: string | null;
  cancelledAt: string | null; cancelReason: string | null;
  createdAt: string; updatedAt: string; supplier: Supplier;
  supplierOffer: SupplierOffer; items: PurchaseOrderItem[];
};
export type ProcurementTask = {
  id: string; status: string; items: TaskItem[];
  supplierOffers: SupplierOffer[]; purchaseOrders?: PurchaseOrder[];
};

type Draft = { selected: boolean; quantity: string; price: string; inStock: boolean; notes: string };
type OrderDraft = { selected: boolean; quantity: string };
type ActionName = 'send-to-payment' | 'confirm-payment' | 'ship' | 'ready-for-pickup' | 'receive' | 'hand-over' | 'cancel';
type ActionForm = { order: PurchaseOrder; action: ActionName };

const money = (v: string | number | null) => v === null || !Number.isFinite(Number(v)) ? '—' :
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(Number(v));
const qty = (v: string | number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(Number(v));
const date = (v: string | null) => v ? new Date(v).toLocaleString('ru-RU') : '—';
const localDate = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const milli = (v: string | number) => Math.round(Number(v) * 1000);
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500';
const primaryClass = 'rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryClass = 'rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40';
const orderLabels: Record<string, string> = {
  ORDERED: 'Заказ оформлен', WAITING_PAYMENT: 'Ожидает оплаты', WAITING_SHIPMENT: 'Ожидает отгрузки',
  IN_TRANSIT: 'В пути', READY_FOR_PICKUP: 'Готово к получению', RECEIVED: 'Получено',
  HANDED_OVER: 'Передано', CANCELLED: 'Отменено',
};
const orderColors: Record<string, string> = {
  ORDERED: 'bg-indigo-50 text-indigo-700', WAITING_PAYMENT: 'bg-amber-50 text-amber-700',
  WAITING_SHIPMENT: 'bg-orange-50 text-orange-700', IN_TRANSIT: 'bg-blue-50 text-blue-700',
  READY_FOR_PICKUP: 'bg-cyan-50 text-cyan-700', RECEIVED: 'bg-emerald-50 text-emerald-700',
  HANDED_OVER: 'bg-teal-50 text-teal-700', CANCELLED: 'bg-rose-50 text-rose-700',
};

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
    <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4"><h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-lg px-3 py-1 text-2xl text-slate-400 hover:bg-slate-100">×</button></div>
      {children}
    </div>
  </div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>;
}

export default function ProcurementWorkspace({ task, mode, busy, onAction, onNavigate }: {
  task: ProcurementTask;
  mode: 'offers' | 'orders';
  busy: boolean;
  onAction: (path: string, init: RequestInit, success: string, onFailure?: (message: string) => void) => Promise<boolean>;
  onNavigate: (mode: 'offers' | 'orders') => void;
}) {
  const [offerOpen, setOfferOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<SupplierOffer | null>(null);
  const [supplier, setSupplier] = useState({ name: '', contact: '', phone: '', email: '', website: '' });
  const [deliveryPrice, setDeliveryPrice] = useState('');
  const [deliveryDays, setDeliveryDays] = useState('');
  const [offerNotes, setOfferNotes] = useState('');
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [orderOffer, setOrderOffer] = useState<SupplierOffer | null>(null);
  const [orderDraft, setOrderDraft] = useState<Record<string, OrderDraft>>({});
  const [invoice, setInvoice] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(localDate());
  const [orderNotes, setOrderNotes] = useState('');
  const [actionForm, setActionForm] = useState<ActionForm | null>(null);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [shippedAt, setShippedAt] = useState(localDate());
  const [expectedAt, setExpectedAt] = useState('');
  const [handedTo, setHandedTo] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [localError, setLocalError] = useState('');

  const orders = useMemo(() => task.purchaseOrders ?? [], [task.purchaseOrders]);
  const active = useMemo(() => orders.filter(o => !o.cancelledAt && o.status !== 'CANCELLED'), [orders]);
  const allocation = useMemo(() => {
    const result = new Map<string, { ordered: number; handed: number }>();
    for (const order of active) for (const line of order.items ?? []) {
      if (!line.taskItemId) continue;
      const prev = result.get(line.taskItemId) ?? { ordered: 0, handed: 0 };
      const amount = milli(line.quantity);
      result.set(line.taskItemId, { ordered: prev.ordered + amount, handed: prev.handed + (order.status === 'HANDED_OVER' ? amount : 0) });
    }
    return result;
  }, [active]);
  const allAllocated = task.items.length > 0 && task.items.every(i => (allocation.get(i.id)?.ordered ?? 0) >= milli(i.quantity));
  const allHanded = task.items.length > 0 && task.items.every(i => (allocation.get(i.id)?.handed ?? 0) >= milli(i.quantity));
  const isClosed = task.status === 'CLOSED' || task.status === 'CANCELLED';
  const orderByOffer = (id: string) => active.some(o => o.supplierOfferId === id);
  const available = (id: string) => Math.max(0, milli(task.items.find(i => i.id === id)?.quantity ?? 0) - (allocation.get(id)?.ordered ?? 0)) / 1000;
  const offeredTotal = task.items.reduce((sum, item) => {
    const row = draft[item.id]; return row?.selected && row.price !== '' ? sum + Number(row.quantity || 0) * Number(row.price) : sum;
  }, 0);
  const offeredPriced = task.items.filter(item => draft[item.id]?.selected).every(item => draft[item.id]?.price !== '');
  const orderPrice = orderOffer?.items.reduce((sum, item) => {
    const row = orderDraft[item.id]; return sum + (row?.selected ? Number(row.quantity || 0) * Number(item.unitPrice ?? 0) : 0);
  }, 0) ?? 0;

  function openOffer() {
    setEditingOffer(null);
    setLocalError('');
    setDraft(Object.fromEntries(task.items.map(i => [i.id, { selected: true, quantity: String(i.quantity), price: '', inStock: true, notes: '' }])));
    setOfferOpen(true);
  }
  function openEditOffer(offer: SupplierOffer) {
    setEditingOffer(offer); setLocalError('');
    setSupplier({ name: offer.supplier.name, contact: offer.supplier.contact ?? '',
      phone: offer.supplier.phone ?? '', email: offer.supplier.email ?? '', website: offer.supplier.website ?? '' });
    setDeliveryPrice(offer.deliveryPrice === null ? '' : String(offer.deliveryPrice));
    setDeliveryDays(offer.deliveryDays === null ? '' : String(offer.deliveryDays));
    setOfferNotes(offer.notes ?? '');
    const byItem = new Map(offer.items.map(item => [item.taskItemId, item]));
    setDraft(Object.fromEntries(task.items.map(item => {
      const line = byItem.get(item.id);
      return [item.id, { selected: Boolean(line), quantity: line ? String(line.quantity) : String(item.quantity),
        price: line?.unitPrice === null || !line ? '' : String(line.unitPrice),
        inStock: line?.inStock ?? true, notes: line?.notes ?? '' }];
    })));
    setOfferOpen(true);
  }
  function openOrder(offer: SupplierOffer) {
    setLocalError(''); setOrderOffer(offer); setInvoice(''); setInvoiceDate(localDate()); setOrderNotes('');
    setOrderDraft(Object.fromEntries(offer.items.map(i => {
      const amount = Math.min(Number(i.quantity), available(i.taskItemId));
      return [i.id, { selected: amount > 0, quantity: amount > 0 ? String(amount) : '0' }];
    })));
  }
  function updateDraft(id: string, patch: Partial<Draft>) { setDraft(prev => ({ ...prev, [id]: { ...prev[id], ...patch } })); }
  function updateOrderDraft(id: string, patch: Partial<OrderDraft>) { setOrderDraft(prev => ({ ...prev, [id]: { ...prev[id], ...patch } })); }

  async function saveOffer(event: FormEvent) {
    event.preventDefault(); setLocalError('');
    const selected = task.items.filter(i => draft[i.id]?.selected);
    if (!supplier.name.trim() || !selected.length) { setLocalError('Укажите поставщика и выберите позиции'); return; }
    for (const item of selected) {
      const row = draft[item.id]; const amount = Number(row.quantity);
      if (!Number.isFinite(amount) || amount <= 0 || milli(amount) > milli(item.quantity) || Math.abs(amount * 1000 - milli(amount)) > 1e-6) {
        setLocalError(`Проверьте количество позиции «${item.name}»`); return;
      }
      if (row.price !== '' && (!Number.isFinite(Number(row.price)) || Number(row.price) < 0)) {
        setLocalError(`Проверьте цену позиции «${item.name}»`); return;
      }
    }
    const ok = await onAction(editingOffer ? `/supplier-offers/${editingOffer.id}` : '/supplier-offers', { method: editingOffer ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierName: supplier.name.trim(), contact: supplier.contact.trim() || undefined,
        phone: supplier.phone.trim() || undefined, email: supplier.email.trim() || undefined,
        website: supplier.website.trim() || undefined,
        deliveryPrice: deliveryPrice === '' ? undefined : Number(deliveryPrice),
        deliveryDays: deliveryDays === '' ? undefined : Number(deliveryDays), notes: offerNotes.trim() || undefined,
        items: selected.map(i => ({ taskItemId: i.id, quantity: Number(draft[i.id].quantity),
          unitPrice: draft[i.id].price === '' ? undefined : Number(draft[i.id].price),
          currency: 'RUB', inStock: draft[i.id].inStock, notes: draft[i.id].notes.trim() || undefined })),
      }),
    }, editingOffer ? 'КП обновлено' : 'Коммерческое предложение сохранено', setLocalError);
    if (ok) { setOfferOpen(false); setEditingOffer(null); setSupplier({ name: '', contact: '', phone: '', email: '', website: '' }); setDeliveryPrice(''); setDeliveryDays(''); setOfferNotes(''); }
  }

  async function saveOrder(event: FormEvent) {
    event.preventDefault(); if (!orderOffer) return;
    setLocalError('');
    const selected = orderOffer.items.filter(i => orderDraft[i.id]?.selected);
    if (!selected.length) { setLocalError('Выберите позиции для заказа'); return; }
    for (const item of selected) {
      const amount = Number(orderDraft[item.id].quantity);
      if (!Number.isFinite(amount) || amount <= 0 || milli(amount) > milli(item.quantity) || milli(amount) > milli(available(item.taskItemId)) || Math.abs(amount * 1000 - milli(amount)) > 1e-6) {
        setLocalError(`Проверьте количество «${item.taskItem.name}». Доступно ${qty(available(item.taskItemId))} ${item.taskItem.unit}`); return;
      }
    }
    if (!invoice.trim() || !invoiceDate) { setLocalError('Укажите номер и дату счёта'); return; }
    const ok = await onAction(`/supplier-offers/${orderOffer.id}/purchase-order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceNumber: invoice.trim(), invoiceDate: new Date(invoiceDate).toISOString(),
        notes: orderNotes.trim() || undefined,
        items: selected.map(i => ({ supplierOfferItemId: i.id, quantity: Number(orderDraft[i.id].quantity) })),
      }),
    }, `Заказ у «${orderOffer.supplier.name}» оформлен`, setLocalError);
    if (ok) { setOrderOffer(null); onNavigate('orders'); }
  }

  function beginAction(order: PurchaseOrder, action: ActionName) {
    setLocalError(''); setActionForm({ order, action }); setCarrier(''); setTracking('');
    setShippedAt(localDate()); setExpectedAt(''); setHandedTo(''); setCancelReason('');
  }
  async function submitAction(event: FormEvent) {
    event.preventDefault(); if (!actionForm) return;
    const { order, action } = actionForm;
    if (action === 'cancel' && !cancelReason.trim()) { setLocalError('Укажите причину отмены'); return; }
    if (action === 'hand-over' && !handedTo.trim()) { setLocalError('Укажите получателя'); return; }
    if (action === 'ship' && (!carrier.trim() || !shippedAt)) { setLocalError('Укажите перевозчика и дату отгрузки'); return; }
    const body = action === 'cancel' ? { reason: cancelReason.trim() }
      : action === 'hand-over' ? { handedOverTo: handedTo.trim() }
      : action === 'ship' ? { carrier: carrier.trim(), shippedAt: new Date(shippedAt).toISOString(),
          trackingNumber: tracking.trim() || undefined, expectedDeliveryAt: expectedAt ? new Date(expectedAt).toISOString() : undefined }
      : {};
    const ok = await onAction(`/orders/${order.id}/${action}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, action === 'cancel' ? 'Заказ отменён, количество снова доступно' : `Заказ «${order.supplier.name}» обновлён`, setLocalError);
    if (ok) setActionForm(null);
  }
  async function closeTask() {
    if (!window.confirm('Все позиции переданы получателям. Закрыть закупку?')) return;
    await onAction('/orders/close', { method: 'PATCH' }, 'Закупка закрыта');
  }

  const allocationView = <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-slate-900">Распределение позиций</h3>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${allHanded ? 'bg-emerald-50 text-emerald-700' : allAllocated ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
        {allHanded ? 'Все позиции переданы' : allAllocated ? 'Полностью заказано' : 'Есть незаказанные позиции'}
      </span>
    </div>
    {!task.items.length ? <p className="mt-3 text-sm text-amber-700">Сначала добавьте позиции на вкладке «Позиции».</p> :
      <div className="mt-4 space-y-4">{task.items.map(item => {
        const ordered = (allocation.get(item.id)?.ordered ?? 0) / 1000;
        const handed = (allocation.get(item.id)?.handed ?? 0) / 1000;
        const required = Number(item.quantity);
        return <div key={item.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><div className="font-medium text-slate-800">{item.name} <span className="text-xs font-normal text-slate-400">{item.partNumber ?? ''}</span></div>
            <div className="text-xs text-slate-500">Заказано {qty(ordered)} / {qty(required)} {item.unit} · Передано {qty(handed)}</div></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, (ordered / required) * 100)}%` }} /></div>
          <div className="mt-1 text-xs text-slate-400">Осталось заказать: {qty(available(item.id))} {item.unit}</div>
        </div>;
      })}</div>}
  </section>;

  return <section className="space-y-5">
    {allocationView}
    {mode === 'offers' ? <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-slate-950">Коммерческие предложения</h2>
          <p className="mt-1 text-sm text-slate-500">Каждый поставщик предлагает конкретные позиции, цены и количество. Разные наборы позиций нельзя сравнивать только по общей сумме.</p></div>
        <button disabled={busy || isClosed || !task.items.length} onClick={openOffer} className={primaryClass}>＋ Добавить КП</button>
      </div>
      {!task.supplierOffers.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Пока нет предложений поставщиков. Добавьте первое КП.</div> :
        <div className="grid gap-4 xl:grid-cols-2">{task.supplierOffers.map(offer => {
          const ordered = orderByOffer(offer.id);
          const known = offer.price !== null;
          return <article key={offer.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-950">{offer.supplier.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{[offer.supplier.contact, offer.supplier.phone, offer.supplier.email].filter(Boolean).join(' · ') || 'Контакты не указаны'}</p></div>
              {ordered && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Заказ оформлен</span>}</div>
            {!offer.items?.length ? <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">КП старого формата без позиций. Для многопоставочного заказа добавьте новое КП с позициями.</div> :
              <div className="mt-4 space-y-2">{offer.items.map(item => <div key={item.id} className="rounded-xl bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2"><div className="text-sm font-medium text-slate-800">{item.taskItem.name}</div>
                  <div className="text-sm font-semibold text-slate-800">{item.unitPrice === null ? 'Цена не указана' : money(Number(item.unitPrice) * Number(item.quantity))}</div></div>
                <p className="mt-1 text-xs text-slate-500">{qty(item.quantity)} {item.taskItem.unit} · {money(item.unitPrice)} / {item.taskItem.unit} · {item.inStock === true ? 'В наличии' : item.inStock === false ? 'Под заказ' : 'Наличие не указано'}</p>
                {item.notes && <p className="mt-1 text-xs text-slate-500">{item.notes}</p>}
              </div>)}</div>}
            <div className="mt-4 flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-4 text-sm"><div><span className="text-slate-500">Товары: </span><b>{money(offer.price)}</b>
              <div className="text-xs text-slate-500">Доставка: {money(offer.deliveryPrice)} · Срок: {offer.deliveryDays ?? '—'} дн.</div></div>
              <div className="text-right"><span className="text-xs text-slate-400">Итого по КП</span><div className="font-bold">{known ? money(Number(offer.price) + Number(offer.deliveryPrice ?? 0)) : 'Не рассчитано'}</div></div></div>
            {offer.notes && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{offer.notes}</p>}
            {!isClosed && !orders.some(order => order.supplierOfferId === offer.id) && <button disabled={busy} onClick={() => openEditOffer(offer)} className={`mt-4 ${secondaryClass}`}>Изменить КП</button>}
            {!ordered && offer.items?.length > 0 && !isClosed && <button disabled={busy || offer.items.every(i => available(i.taskItemId) <= 0)} onClick={() => openOrder(offer)} className={`mt-4 w-full ${primaryClass}`}>Оформить заказ у поставщика →</button>}
          </article>;
        })}</div>}
    </> : <>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-950">Заказы поставщикам</h2>
        <p className="mt-1 text-sm text-slate-500">У каждого заказа свой счёт, оплата, доставка и передача. Отменённые заказы остаются в истории.</p></div>
        {!isClosed && !allAllocated && <button onClick={() => onNavigate('offers')} className={primaryClass}>＋ Оформить ещё заказ</button>}
      </div>
      {!orders.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">Заказов пока нет. Перейдите к КП и оформите первый заказ.</div> :
        <div className="space-y-4">{orders.map(order => <article key={order.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${order.cancelledAt ? 'border-rose-100 opacity-75' : 'border-slate-200'}`}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-950">{order.supplier.name}</h3>
            <p className="mt-1 text-xs text-slate-500">Счёт № {order.invoiceNumber ?? 'не указан'} · {date(order.invoiceDate)} · {qty(order.items?.length ?? 0)} поз.</p></div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${orderColors[order.status] ?? 'bg-slate-100 text-slate-700'}`}>{orderLabels[order.status] ?? order.status}</span></div>
          <div className="mt-4 space-y-2">{order.items?.length ? order.items.map(line => <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm">
            <span>{line.name} <span className="text-xs text-slate-500">· {qty(line.quantity)} {line.unit}</span></span><b>{line.unitPrice === null ? '—' : money(Number(line.quantity) * Number(line.unitPrice))}</b>
          </div>) : <p className="text-xs text-amber-700">Заказ старого формата без детализации по позициям</p>}</div>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><span className="text-slate-400">Товары</span><div className="font-semibold">{money(order.price)}</div></div>
            <div><span className="text-slate-400">Доставка</span><div className="font-semibold">{money(order.deliveryPrice)}</div></div>
            <div><span className="text-slate-400">Итого</span><div className="font-bold">{money(order.totalPrice)}</div></div></div>
          {order.shippedAt && <p className="mt-3 text-xs text-slate-500">Отгружено {date(order.shippedAt)} · {order.carrier ?? '—'}{order.trackingNumber ? ` · ТТН ${order.trackingNumber}` : ''}{order.expectedDeliveryAt ? ` · Ожидается ${date(order.expectedDeliveryAt)}` : ''}</p>}
          {order.handedOverAt && <p className="mt-2 text-xs text-emerald-700">Передано: {order.handedOverTo} · {date(order.handedOverAt)}</p>}
          {order.cancelledAt && <p className="mt-2 text-xs text-rose-600">Отменён: {order.cancelReason ?? 'причина не указана'}</p>}
          {order.notes && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{order.notes}</p>}
          {!order.cancelledAt && !isClosed && <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {order.status === 'ORDERED' && <button disabled={busy} onClick={() => beginAction(order, 'send-to-payment')} className={primaryClass}>Передать счёт на оплату</button>}
            {order.status === 'WAITING_PAYMENT' && <button disabled={busy} onClick={() => beginAction(order, 'confirm-payment')} className={primaryClass}>Подтвердить оплату</button>}
            {order.status === 'WAITING_SHIPMENT' && <button disabled={busy} onClick={() => beginAction(order, 'ship')} className={primaryClass}>Подтвердить отгрузку</button>}
            {order.status === 'IN_TRANSIT' && <button disabled={busy} onClick={() => beginAction(order, 'ready-for-pickup')} className={primaryClass}>Груз прибыл</button>}
            {order.status === 'READY_FOR_PICKUP' && <button disabled={busy} onClick={() => beginAction(order, 'receive')} className={primaryClass}>Подтвердить получение</button>}
            {order.status === 'RECEIVED' && <button disabled={busy} onClick={() => beginAction(order, 'hand-over')} className={primaryClass}>Передать товар</button>}
            {['ORDERED', 'WAITING_PAYMENT'].includes(order.status) && <button disabled={busy} onClick={() => beginAction(order, 'cancel')} className="rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50">Отменить заказ</button>}
          </div>}
        </article>)}</div>}
      {allHanded && !isClosed && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="font-semibold text-emerald-800">Все необходимые позиции переданы получателям</div>
        <p className="mt-1 text-sm text-emerald-700">Теперь закупку можно закрыть.</p><button disabled={busy} onClick={closeTask} className="mt-3 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Закрыть закупку</button></div>}
    </>}

    {offerOpen && <Dialog title={editingOffer ? "Редактировать КП" : "Новое коммерческое предложение"} onClose={() => setOfferOpen(false)}>
      <form onSubmit={saveOffer} className="space-y-5"><div className="grid gap-3 sm:grid-cols-2">
        <Field label="Поставщик *"><input autoFocus required className={inputClass} value={supplier.name} onChange={e => setSupplier(s => ({ ...s, name: e.target.value }))} placeholder="ООО «ПромСнаб»" /></Field>
        <Field label="Контактное лицо"><input className={inputClass} value={supplier.contact} onChange={e => setSupplier(s => ({ ...s, contact: e.target.value }))} /></Field>
        <Field label="Телефон"><input className={inputClass} value={supplier.phone} onChange={e => setSupplier(s => ({ ...s, phone: e.target.value }))} /></Field>
        <Field label="Email"><input type="email" className={inputClass} value={supplier.email} onChange={e => setSupplier(s => ({ ...s, email: e.target.value }))} /></Field>
        <Field label="Сайт (с https://)"><input type="url" className={inputClass} value={supplier.website} onChange={e => setSupplier(s => ({ ...s, website: e.target.value }))} placeholder="https://example.ru" /></Field>
      </div>
      <div><h3 className="font-semibold text-slate-900">Позиции предложения</h3><p className="mt-1 text-xs text-slate-500">Снимите галочку с позиций, которые поставщик не предлагает. Можно указать частичное количество.</p>
        <div className="mt-3 space-y-3">{task.items.map(item => {
          const row = draft[item.id]; if (!row) return null;
          return <div key={item.id} className="rounded-xl border border-slate-200 p-3">
            <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={row.selected} onChange={e => updateDraft(item.id, { selected: e.target.checked })} />{item.name} <span className="font-normal text-slate-400">нужно {qty(item.quantity)} {item.unit}</span></label>
            {row.selected && <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={`Количество, ${item.unit} *`}><input required type="number" min="0.001" max={Number(item.quantity)} step="0.001" className={inputClass} value={row.quantity} onChange={e => updateDraft(item.id, { quantity: e.target.value })} /></Field>
              <Field label="Цена за единицу, ₽"><input type="number" min="0" step="0.01" className={inputClass} value={row.price} onChange={e => updateDraft(item.id, { price: e.target.value })} placeholder="Можно оставить пустым" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.inStock} onChange={e => updateDraft(item.id, { inStock: e.target.checked })} />В наличии</label>
              <div className="text-right text-sm font-semibold">Сумма: {row.price === '' ? '—' : money(Number(row.price) * Number(row.quantity))}</div>
              <div className="sm:col-span-2"><input className={inputClass} value={row.notes} onChange={e => updateDraft(item.id, { notes: e.target.value })} placeholder="Комментарий по позиции" /></div>
            </div>}
          </div>;
        })}</div></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Стоимость доставки, ₽"><input type="number" min="0" step="0.01" className={inputClass} value={deliveryPrice} onChange={e => setDeliveryPrice(e.target.value)} /></Field>
        <Field label="Срок поставки, дней"><input type="number" min="0" step="1" className={inputClass} value={deliveryDays} onChange={e => setDeliveryDays(e.target.value)} /></Field></div>
      <div className="rounded-xl bg-blue-50 p-4 text-sm"><div className="flex justify-between"><span>Товары</span><b>{offeredPriced ? money(offeredTotal) : 'Не все цены указаны'}</b></div>
        <div className="mt-2 flex justify-between"><span>Итого с доставкой</span><b>{offeredPriced ? money(offeredTotal + Number(deliveryPrice || 0)) : '—'}</b></div></div>
      <Field label="Комментарий к КП"><textarea rows={3} className={inputClass} value={offerNotes} onChange={e => setOfferNotes(e.target.value)} /></Field>
      {localError && <p className="text-sm text-rose-600">{localError}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setOfferOpen(false)} className={secondaryClass}>Отмена</button><button disabled={busy || !task.items.some(i => draft[i.id]?.selected)} className={primaryClass}>{editingOffer ? "Сохранить изменения" : "Сохранить КП"}</button></div>
      </form>
    </Dialog>}

    {orderOffer && <Dialog title={`Оформить заказ у «${orderOffer.supplier.name}»`} onClose={() => setOrderOffer(null)}>
      <form onSubmit={saveOrder} className="space-y-5"><p className="text-sm text-slate-500">Укажите, сколько из предложенного количества заказываем сейчас. Система не позволит превысить остаток закупки.</p>
        <div className="space-y-3">{orderOffer.items.map(item => {
          const row = orderDraft[item.id]; if (!row) return null;
          const remaining = available(item.taskItemId);
          return <div key={item.id} className="rounded-xl border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" disabled={remaining <= 0} checked={row.selected} onChange={e => updateOrderDraft(item.id, { selected: e.target.checked })} />{item.taskItem.name}</label>
            <p className="mt-1 text-xs text-slate-500">Предложено {qty(item.quantity)} · осталось заказать {qty(remaining)} {item.taskItem.unit} · цена {money(item.unitPrice)} / {item.taskItem.unit}</p>
            {row.selected && <div className="mt-3 grid items-end gap-3 sm:grid-cols-2"><Field label="Заказать, количество *"><input type="number" min="0.001" step="0.001" max={Math.min(Number(item.quantity), remaining)} required className={inputClass} value={row.quantity} onChange={e => updateOrderDraft(item.id, { quantity: e.target.value })} /></Field>
              <div className="text-sm font-semibold">Сумма: {item.unitPrice === null ? '—' : money(Number(row.quantity) * Number(item.unitPrice))}</div></div>}
          </div>;
        })}</div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Номер счёта *"><input required className={inputClass} value={invoice} onChange={e => setInvoice(e.target.value)} /></Field>
          <Field label="Дата счёта *"><input required type="datetime-local" className={inputClass} value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></Field></div>
        <Field label="Примечание"><textarea rows={2} className={inputClass} value={orderNotes} onChange={e => setOrderNotes(e.target.value)} /></Field>
        <div className="rounded-xl bg-blue-50 p-4 text-sm"><div className="flex justify-between"><span>Товары по заказу</span><b>{money(orderPrice)}</b></div>
          <div className="mt-2 flex justify-between"><span>Доставка по КП</span><b>{money(orderOffer.deliveryPrice)}</b></div>
          <div className="mt-2 flex justify-between font-semibold"><span>Итого</span><span>{orderOffer.items.filter(i => orderDraft[i.id]?.selected).some(i => i.unitPrice === null) ? 'Не все цены известны' : money(orderPrice + Number(orderOffer.deliveryPrice ?? 0))}</span></div></div>
        {localError && <p className="text-sm text-rose-600">{localError}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setOrderOffer(null)} className={secondaryClass}>Отмена</button><button disabled={busy || !orderOffer.items.some(i => orderDraft[i.id]?.selected)} className={primaryClass}>Оформить заказ</button></div>
      </form>
    </Dialog>}

    {actionForm && <Dialog title={`${orderLabels[actionForm.order.status] ?? 'Заказ'} · ${actionForm.order.supplier.name}`} onClose={() => setActionForm(null)}>
      <form onSubmit={submitAction} className="space-y-4"><p className="text-sm text-slate-600">Счёт № {actionForm.order.invoiceNumber ?? '—'} · {money(actionForm.order.totalPrice)}</p>
        {actionForm.action === 'ship' && <><div className="grid gap-3 sm:grid-cols-2"><Field label="Дата отгрузки *"><input required type="datetime-local" className={inputClass} value={shippedAt} onChange={e => setShippedAt(e.target.value)} /></Field>
          <Field label="Ожидаемая дата прибытия"><input type="datetime-local" className={inputClass} value={expectedAt} onChange={e => setExpectedAt(e.target.value)} /></Field></div>
          <Field label="Перевозчик *"><input required className={inputClass} value={carrier} onChange={e => setCarrier(e.target.value)} /></Field>
          <Field label="Трек / ТТН"><input className={inputClass} value={tracking} onChange={e => setTracking(e.target.value)} /></Field></>}
        {actionForm.action === 'hand-over' && <Field label="Кому передан товар *"><input required autoFocus className={inputClass} value={handedTo} onChange={e => setHandedTo(e.target.value)} /></Field>}
        {actionForm.action === 'cancel' && <><p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Отмена освободит количество для других поставщиков. Отменить оплаченный заказ нельзя.</p>
          <Field label="Причина отмены *"><textarea required rows={3} className={inputClass} value={cancelReason} onChange={e => setCancelReason(e.target.value)} /></Field></>}
        {['send-to-payment', 'confirm-payment', 'ready-for-pickup', 'receive'].includes(actionForm.action) && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Подтвердите действие. Оно будет сохранено в истории закупки.</p>}
        {localError && <p className="text-sm text-rose-600">{localError}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setActionForm(null)} className={secondaryClass}>Назад</button>
          <button disabled={busy} className={actionForm.action === 'cancel' ? 'rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40' : primaryClass}>
            {actionForm.action === 'cancel' ? 'Отменить заказ' : 'Подтвердить'}</button></div>
      </form>
    </Dialog>}
  </section>;
}
