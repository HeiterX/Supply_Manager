'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import AppShell from '../../components/AppShell';

type Activity = { id: string; taskId: string; text: string; createdAt: string };
import ProcurementWorkspace, {
  type SupplierOffer, type PurchaseOrder, type TaskItem,
} from './ProcurementWorkspace';

type Task = {
  id: string; number: number; title: string; description: string | null; status: string; priority: string;
  deadline: string | null; nextAction: string | null; reminderAt: string | null; createdAt: string; updatedAt: string; closedAt: string | null;
  selectedOfferId: string | null; selectedOffer: SupplierOffer | null; activities: Activity[]; items: TaskItem[]; supplierOffers: SupplierOffer[];
  purchaseOrder: PurchaseOrder | null; purchaseOrders?: PurchaseOrder[];
};

type Tab = 'overview' | 'items' | 'offers' | 'order' | 'history';
type HistoryFilter = 'all' | 'events' | 'notes';

const API_URL = 'http://localhost:3000/api/v1';
const statusLabels: Record<string, string> = {
  NEW: 'Новая', SEARCHING: 'Поиск поставщика', NEGOTIATION: 'Переговоры / согласование', ORDERED: 'Заказано',
  WAITING_PAYMENT: 'Ожидает оплаты', WAITING_SHIPMENT: 'Ожидает отгрузки', IN_TRANSIT: 'В пути',
  READY_FOR_PICKUP: 'Готово к получению', RECEIVED: 'Получено', HANDED_OVER: 'Передано', CLOSED: 'Закрыто', CANCELLED: 'Отменено',
};
const statusTone: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700', SEARCHING: 'bg-violet-50 text-violet-700', NEGOTIATION: 'bg-fuchsia-50 text-fuchsia-700',
  ORDERED: 'bg-indigo-50 text-indigo-700', WAITING_PAYMENT: 'bg-amber-50 text-amber-700', WAITING_SHIPMENT: 'bg-orange-50 text-orange-700',
  IN_TRANSIT: 'bg-blue-50 text-blue-700', READY_FOR_PICKUP: 'bg-cyan-50 text-cyan-700', RECEIVED: 'bg-emerald-50 text-emerald-700',
  HANDED_OVER: 'bg-teal-50 text-teal-700', CLOSED: 'bg-slate-100 text-slate-500', CANCELLED: 'bg-rose-50 text-rose-700',
};
const priorityLabels: Record<string, string> = { LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', URGENT: 'Срочный' };

function formatMoney(value: string | number | null, currency = 'RUB') {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}
function formatQuantity(value: string | number) {
  const n = Number(value); return Number.isFinite(n) ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(n) : String(value);
}
function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function toDateTimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16);
}
function offerTotal(offer: SupplierOffer) { return Number(offer.price ?? 0) + Number(offer.deliveryPrice ?? 0); }
function itemTotal(item: TaskItem) { return item.unitPrice === null ? null : Number(item.unitPrice) * Number(item.quantity); }

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getActivityMeta(text: string) {
  const normalized = text.trim().toLowerCase();

  if (
    normalized.startsWith('товар передан') ||
    normalized.startsWith('товар получен') ||
    normalized.startsWith('груз прибыл') ||
    normalized.startsWith('заказ отгружен')
  ) {
    return {
      kind: 'event' as const,
      label: 'Логистика',
      icon: '→',
      dotClass: 'bg-blue-600 text-white',
      badgeClass: 'bg-blue-50 text-blue-700',
    };
  }

  if (
    normalized.startsWith('счёт') ||
    normalized.startsWith('оплата') ||
    normalized.startsWith('оформлен заказ')
  ) {
    return {
      kind: 'event' as const,
      label: 'Заказ',
      icon: '₽',
      dotClass: 'bg-amber-500 text-white',
      badgeClass: 'bg-amber-50 text-amber-700',
    };
  }

  if (
    normalized.startsWith('выбран поставщик') ||
    normalized.startsWith('добавлено предложение')
  ) {
    return {
      kind: 'event' as const,
      label: 'Поставщик',
      icon: '◇',
      dotClass: 'bg-violet-500 text-white',
      badgeClass: 'bg-violet-50 text-violet-700',
    };
  }

  if (
    normalized.startsWith('этап изменён') ||
    normalized.startsWith('приоритет изменён') ||
    normalized.startsWith('следующее действие') ||
    normalized.startsWith('напоминание')
  ) {
    return {
      kind: 'event' as const,
      label: 'Изменение',
      icon: '↻',
      dotClass: 'bg-slate-700 text-white',
      badgeClass: 'bg-slate-100 text-slate-600',
    };
  }

  if (
    normalized.startsWith('заказ отменён') ||
    normalized.includes('отменён')
  ) {
    return {
      kind: 'event' as const,
      label: 'Отмена',
      icon: '×',
      dotClass: 'bg-rose-500 text-white',
      badgeClass: 'bg-rose-50 text-rose-700',
    };
  }

  if (
    normalized.startsWith('закупка закрыта') ||
    normalized.startsWith('закрыто')
  ) {
    return {
      kind: 'event' as const,
      label: 'Завершение',
      icon: '✓',
      dotClass: 'bg-emerald-500 text-white',
      badgeClass: 'bg-emerald-50 text-emerald-700',
    };
  }

  return {
    kind: 'note' as const,
    label: 'Заметка',
    icon: '•',
    dotClass: 'bg-cyan-500 text-white',
    badgeClass: 'bg-cyan-50 text-cyan-700',
  };
}

export default function TaskPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const [priority, setPriority] = useState('NORMAL');
  const [nextAction, setNextAction] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [editNextAction, setEditNextAction] = useState(false);

  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemPartNumber, setItemPartNumber] = useState('');
  const [itemQuantity, setItemQuantity] = useState('1');
  const [itemUnit, setItemUnit] = useState('шт.');
  const [itemUnitPrice, setItemUnitPrice] = useState('');
  const [itemNotes, setItemNotes] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [supplierWebsite, setSupplierWebsite] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [deliveryPrice, setDeliveryPrice] = useState('');
  const [deliveryDays, setDeliveryDays] = useState('');
  const [inStock, setInStock] = useState(true);
  const [supplierNotes, setSupplierNotes] = useState('');
  const [offerSort, setOfferSort] = useState<'total' | 'delivery' | 'recent'>('total');

  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [purchaseOrderNotes, setPurchaseOrderNotes] = useState('');

  const [shipModalOpen, setShipModalOpen] = useState(false);
  const [shippedAt, setShippedAt] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [expectedDeliveryAt, setExpectedDeliveryAt] = useState('');
  const [handOverModalOpen, setHandOverModalOpen] = useState(false);
  const [handedOverTo, setHandedOverTo] = useState('');
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [activityText, setActivityText] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

  async function loadTask() {
    try {
      setLoadError('');
      const response = await fetch(`${API_URL}/tasks/${taskId}`);
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as Task;
      setTask(data); setPriority(data.priority); setNextAction(data.nextAction ?? ''); setReminderAt(toDateTimeLocal(data.reminderAt));
    } catch (error) { console.error(error); setLoadError('Не удалось загрузить карточку закупки.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadTask(); }, [taskId]);

  async function apiAction(path: string, init: RequestInit, success: string, onFailure?: (message: string) => void) {
    setBusy(true); setMessage(''); setActionError('');
    try {
      const response = await fetch(`${API_URL}/tasks/${taskId}${path}`, init);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Ошибка запроса');
      }
      await loadTask(); setMessage(success); return true;
    } catch (error) {
      console.error(error);
      let message = 'Не удалось выполнить действие. Проверьте данные и повторите.';
      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          const details = parsed.message;
          if (Array.isArray(details)) message = details.join('; ');
          else if (typeof details === 'string') message = details;
        } catch { /* network error */ }
      }
      setActionError(message);
      onFailure?.(message);
      return false;
    }
    finally { setBusy(false); }
  }

  async function saveOverview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiAction('', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority, nextAction, reminderAt: reminderAt ? new Date(reminderAt).toISOString() : undefined }),
    }, 'Основная информация сохранена');
  }

  function openNewItem() {
    setEditingItemId(null); setItemName(''); setItemPartNumber(''); setItemQuantity('1'); setItemUnit('шт.'); setItemUnitPrice(''); setItemNotes(''); setItemFormOpen(true);
  }
  function openEditItem(item: TaskItem) {
    setEditingItemId(item.id); setItemName(item.name); setItemPartNumber(item.partNumber ?? ''); setItemQuantity(String(item.quantity)); setItemUnit(item.unit); setItemUnitPrice(item.unitPrice === null ? '' : String(item.unitPrice)); setItemNotes(item.notes ?? ''); setItemFormOpen(true);
  }
  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(itemQuantity); const price = itemUnitPrice.trim() === '' ? undefined : Number(itemUnitPrice);
    if (!itemName.trim() || !itemUnit.trim() || !Number.isFinite(quantity) || quantity <= 0 || (price !== undefined && (!Number.isFinite(price) || price < 0))) {
      setActionError('Проверьте наименование, количество, единицу измерения и цену.'); return;
    }
    const path = editingItemId ? `/items/${editingItemId}` : '/items';
    const ok = await apiAction(path, {
      method: editingItemId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: itemName.trim(), partNumber: itemPartNumber.trim(), quantity, unit: itemUnit.trim(), unitPrice: price, currency: 'RUB', notes: itemNotes.trim() }),
    }, editingItemId ? 'Позиция обновлена' : 'Позиция добавлена');
    if (ok) setItemFormOpen(false);
  }
  async function deleteItem(item: TaskItem) {
    if (!window.confirm(`Удалить позицию «${item.name}»?`)) return;
    await apiAction(`/items/${item.id}`, { method: 'DELETE' }, 'Позиция удалена');
  }

  async function addSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supplierName.trim()) return;
    const ok = await apiAction('/supplier-offers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        supplierName: supplierName.trim(), contact: supplierContact.trim() || undefined, phone: supplierPhone.trim() || undefined,
        email: supplierEmail.trim() || undefined, website: supplierWebsite.trim() || undefined,
        price: offerPrice ? Number(offerPrice) : undefined, deliveryPrice: deliveryPrice ? Number(deliveryPrice) : undefined,
        deliveryDays: deliveryDays ? Number(deliveryDays) : undefined, inStock, notes: supplierNotes.trim() || undefined,
      }),
    }, 'Предложение поставщика добавлено');
    if (ok) { setSupplierFormOpen(false); setSupplierName(''); setSupplierContact(''); setSupplierPhone(''); setSupplierEmail(''); setSupplierWebsite(''); setOfferPrice(''); setDeliveryPrice(''); setDeliveryDays(''); setSupplierNotes(''); setInStock(true); }
  }
  async function selectOffer(offer: SupplierOffer) {
    if (task?.selectedOfferId === offer.id) return;
    if (!window.confirm(`Выбрать поставщика «${offer.supplier.name}»?`)) return;
    await apiAction(`/supplier-offers/${offer.id}/select`, { method: 'PATCH' }, `Поставщик «${offer.supplier.name}» выбран`);
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceNumber.trim() || !invoiceDate) { setActionError('Для оформления заказа укажите номер и дату счёта.'); return; }
    const ok = await apiAction('/purchase-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceNumber: invoiceNumber.trim(), invoiceDate: new Date(invoiceDate).toISOString(), notes: purchaseOrderNotes.trim() || undefined }),
    }, 'Заказ оформлен');
    if (ok) { setOrderFormOpen(false); setInvoiceNumber(''); setInvoiceDate(''); setPurchaseOrderNotes(''); setActiveTab('order'); }
  }

  async function sendToPayment() { await apiAction('/purchase-order/send-to-payment', { method: 'PATCH' }, 'Счёт передан на оплату'); }
  async function confirmPayment() {
    if (!window.confirm(`Подтвердить оплату счёта № ${task?.purchaseOrder?.invoiceNumber ?? 'без номера'}?`)) return;
    await apiAction('/purchase-order/confirm-payment', { method: 'PATCH' }, 'Оплата подтверждена');
  }
  async function submitShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!shippedAt || !carrier.trim()) { setActionError('Укажите дату отгрузки и перевозчика.'); return; }
    const ok = await apiAction('/purchase-order/ship', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shippedAt: new Date(shippedAt).toISOString(), carrier: carrier.trim(), trackingNumber: trackingNumber.trim() || undefined, expectedDeliveryAt: expectedDeliveryAt ? new Date(expectedDeliveryAt).toISOString() : undefined }),
    }, 'Отгрузка подтверждена');
    if (ok) setShipModalOpen(false);
  }
  async function readyForPickup() {
    if (!window.confirm('Подтвердить, что груз прибыл и готов к получению?')) return;
    await apiAction('/purchase-order/ready-for-pickup', { method: 'PATCH' }, 'Груз отмечен как готовый к получению');
  }
  async function receiveOrder() {
    if (!window.confirm('Подтвердить фактическое получение товара?')) return;
    await apiAction('/purchase-order/receive', { method: 'PATCH' }, 'Получение подтверждено');
  }
  async function submitHandOver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!handedOverTo.trim()) return setActionError('Укажите, кому передан товар.');
    const ok = await apiAction('/purchase-order/hand-over', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handedOverTo: handedOverTo.trim() }) }, 'Передача товара подтверждена');
    if (ok) { setHandOverModalOpen(false); setHandedOverTo(''); }
  }
  async function closeOrder() {
    if (!window.confirm('Закрыть закупку? После закрытия она перейдёт в завершённые.')) return;
    await apiAction('/purchase-order/close', { method: 'PATCH' }, 'Закупка закрыта');
  }
  async function cancelOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!cancelReason.trim()) return setActionError('Укажите причину отмены заказа.');
    const ok = await apiAction('/purchase-order/cancel', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: cancelReason.trim() }) }, 'Заказ отменён. Можно выбрать другого поставщика.');
    if (ok) { setCancelModalOpen(false); setCancelReason(''); setActiveTab('offers'); }
  }
  async function addActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activityText.trim()) return;
    const ok = await apiAction('/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: activityText.trim() }) }, 'Запись добавлена в историю');
    if (ok) setActivityText('');
  }

  // Legacy orders have no line items; keep their original UI and endpoints.
  const legacyMode = Boolean(task?.purchaseOrders?.some(order =>
    !order.cancelledAt && (!order.items || order.items.length === 0)));

  const progress = useMemo(() => {
    if (!task) return [];
    if (!legacyMode) {
      const active = (task.purchaseOrders ?? []).filter(order => !order.cancelledAt);
      const ordered = new Map<string, number>();
      const handed = new Map<string, number>();
      for (const order of active) for (const item of order.items ?? []) {
        if (!item.taskItemId) continue;
        ordered.set(item.taskItemId, (ordered.get(item.taskItemId) ?? 0) + Number(item.quantity));
        if (order.status === 'HANDED_OVER') handed.set(item.taskItemId, (handed.get(item.taskItemId) ?? 0) + Number(item.quantity));
      }
      const allOrdered = task.items.length > 0 && task.items.every(item =>
        Math.round((ordered.get(item.id) ?? 0) * 1000) >= Math.round(Number(item.quantity) * 1000));
      const allHanded = task.items.length > 0 && task.items.every(item =>
        Math.round((handed.get(item.id) ?? 0) * 1000) >= Math.round(Number(item.quantity) * 1000));
      return [
        ['Карточка создана', task.createdAt, true],
        ['Получены предложения', task.supplierOffers[0]?.receivedAt ?? null, task.supplierOffers.length > 0],
        ['Все позиции заказаны', null, allOrdered],
        ['Все позиции переданы', null, allHanded],
        ['Закупка закрыта', task.closedAt, task.status === 'CLOSED'],
      ] as Array<[string, string | null, boolean]>;
    }
    const po = task.purchaseOrder;
    return [
      ['Карточка создана', task.createdAt, true],
      ['Поставщик выбран', task.selectedOffer?.receivedAt ?? null, Boolean(task.selectedOffer)],
      ['Заказ оформлен', po?.orderedAt ?? null, Boolean(po)],
      ['Счёт передан на оплату', po?.sentToPaymentAt ?? null, Boolean(po?.sentToPaymentAt)],
      ['Оплата подтверждена', po?.paidAt ?? null, Boolean(po?.paidAt)],
      ['Отгружено поставщиком', po?.shippedAt ?? null, Boolean(po?.shippedAt)],
      ['Готово к получению', po?.readyForPickupAt ?? null, Boolean(po?.readyForPickupAt)],
      ['Получено', po?.receivedAt ?? null, Boolean(po?.receivedAt)],
      ['Передано', po?.handedOverAt ?? null, Boolean(po?.handedOverAt)],
      ['Закрыто', task.closedAt, task.status === 'CLOSED'],
    ] as Array<[string, string | null, boolean]>;
  }, [task, legacyMode]);

  const currentProgressIndex = useMemo(() => {
    const firstIncomplete = progress.findIndex(([, , done]) => !done);
    return firstIncomplete === -1 ? progress.length - 1 : firstIncomplete;
  }, [progress]);

  const currentProgressLabel = useMemo(() => {
    if (!task) return '';
    const labels: Record<string, string> = {
      NEW: 'Поиск поставщика',
      SEARCHING: 'Поиск поставщика',
      NEGOTIATION: 'Оформление заказа',
      ORDERED: 'Передача счёта на оплату',
      WAITING_PAYMENT: 'Ожидание оплаты',
      WAITING_SHIPMENT: 'Ожидание отгрузки',
      IN_TRANSIT: 'В пути',
      READY_FOR_PICKUP: 'Ожидание получения',
      RECEIVED: 'Ожидание передачи',
      HANDED_OVER: 'Ожидание закрытия',
      CLOSED: 'Закрыто',
      CANCELLED: 'Заказ отменён',
    };
    return labels[task.status] ?? '';
  }, [task]);

  const filteredItems = useMemo(() => {
    if (!task) return [];
    const query = itemSearch.trim().toLowerCase();
    if (!query) return task.items;

    return task.items.filter((item) =>
      [item.name, item.partNumber, item.notes, item.unit]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [task, itemSearch]);

  const itemsSummary = useMemo(() => {
    if (!task) return { total: 0, priced: 0, withoutPrice: 0, amount: 0 };

    const pricedItems = task.items.filter((item) => item.unitPrice !== null);
    return {
      total: task.items.length,
      priced: pricedItems.length,
      withoutPrice: task.items.length - pricedItems.length,
      amount: pricedItems.reduce(
        (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
        0,
      ),
    };
  }, [task]);

  const offerComparison = useMemo(() => {
    if (!task) {
      return {
        sorted: [] as SupplierOffer[],
        bestTotalId: null as string | null,
        fastestId: null as string | null,
        inStockCount: 0,
      };
    }

    const offers = [...task.supplierOffers];
    const withPrice = offers.filter((offer) => offer.price !== null);
    const withDelivery = offers.filter(
      (offer) => offer.deliveryDays !== null && offer.deliveryDays >= 0,
    );

    const bestTotal = withPrice.length
      ? withPrice.reduce((best, offer) =>
          offerTotal(offer) < offerTotal(best) ? offer : best,
        )
      : null;

    const fastest = withDelivery.length
      ? withDelivery.reduce((best, offer) =>
          Number(offer.deliveryDays) < Number(best.deliveryDays) ? offer : best,
        )
      : null;

    offers.sort((a, b) => {
      if (offerSort === 'delivery') {
        const aDays = a.deliveryDays ?? Number.POSITIVE_INFINITY;
        const bDays = b.deliveryDays ?? Number.POSITIVE_INFINITY;
        return aDays - bDays || offerTotal(a) - offerTotal(b);
      }

      if (offerSort === 'recent') {
        const aDate = new Date(a.receivedAt ?? a.requestedAt).getTime();
        const bDate = new Date(b.receivedAt ?? b.requestedAt).getTime();
        return bDate - aDate;
      }

      const aTotal = a.price === null ? Number.POSITIVE_INFINITY : offerTotal(a);
      const bTotal = b.price === null ? Number.POSITIVE_INFINITY : offerTotal(b);
      return aTotal - bTotal;
    });

    return {
      sorted: offers,
      bestTotalId: bestTotal?.id ?? null,
      fastestId: fastest?.id ?? null,
      inStockCount: offers.filter((offer) => offer.inStock === true).length,
    };
  }, [task, offerSort]);

  const historyData = useMemo(() => {
    if (!task) {
      return {
        filtered: [] as Activity[],
        grouped: [] as Array<{ date: string; activities: Activity[] }>,
        eventCount: 0,
        noteCount: 0,
      };
    }

    const query = historySearch.trim().toLowerCase();
    const eventCount = task.activities.filter(
      (activity) => getActivityMeta(activity.text).kind === 'event',
    ).length;
    const noteCount = task.activities.length - eventCount;

    const filtered = task.activities.filter((activity) => {
      const meta = getActivityMeta(activity.text);

      if (historyFilter === 'events' && meta.kind !== 'event') return false;
      if (historyFilter === 'notes' && meta.kind !== 'note') return false;
      if (query && !activity.text.toLowerCase().includes(query)) return false;

      return true;
    });

    const groups = new Map<string, Activity[]>();

    for (const activity of filtered) {
      const date = formatHistoryDate(activity.createdAt);
      const current = groups.get(date) ?? [];
      current.push(activity);
      groups.set(date, current);
    }

    return {
      filtered,
      grouped: Array.from(groups.entries()).map(([date, activities]) => ({
        date,
        activities,
      })),
      eventCount,
      noteCount,
    };
  }, [task, historySearch, historyFilter]);

  const orderFlow = useMemo(() => {
    const po = task?.purchaseOrder;
    if (!task || !po) return [];

    return [
      { label: 'Заказ оформлен', date: po.orderedAt, done: true },
      { label: 'Счёт передан на оплату', date: po.sentToPaymentAt, done: Boolean(po.sentToPaymentAt) },
      { label: 'Оплата подтверждена', date: po.paidAt, done: Boolean(po.paidAt) },
      { label: 'Отгружено поставщиком', date: po.shippedAt, done: Boolean(po.shippedAt) },
      { label: 'Груз прибыл', date: po.readyForPickupAt, done: Boolean(po.readyForPickupAt) },
      { label: 'Товар получен', date: po.receivedAt, done: Boolean(po.receivedAt) },
      { label: 'Товар передан', date: po.handedOverAt, done: Boolean(po.handedOverAt) },
      { label: 'Закупка закрыта', date: task.closedAt, done: task.status === 'CLOSED' },
    ];
  }, [task]);

  const currentOrderStepIndex = useMemo(() => {
    const firstIncomplete = orderFlow.findIndex((step) => !step.done);
    return firstIncomplete === -1 ? orderFlow.length - 1 : firstIncomplete;
  }, [orderFlow]);

  function CurrentAction() {
    if (!task) return null;
    if (!legacyMode) {
      if (task.status === 'CLOSED') return <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-700">Закупка завершена</div>;
      if (task.status === 'CANCELLED') return null;
      const activeOrders = (task.purchaseOrders ?? []).filter(order => !order.cancelledAt);
      return <button onClick={() => setActiveTab(activeOrders.length ? 'order' : 'offers')}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">
        {activeOrders.length ? 'Управлять заказами поставщиков' : 'Добавить предложение поставщика'}
      </button>;
    }
    const status = task.status;
    const base = 'w-full rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
    if (status === 'NEW' || status === 'SEARCHING') return <button onClick={() => setActiveTab('offers')} className={`${base} bg-blue-600 text-white hover:bg-blue-700`}>Добавить / выбрать поставщика</button>;
    if (status === 'NEGOTIATION' && !task.purchaseOrder) return <button onClick={() => { setActiveTab('offers'); setOrderFormOpen(true); }} className={`${base} bg-blue-600 text-white hover:bg-blue-700`}>Оформить заказ</button>;
    if (status === 'ORDERED') return <button disabled={busy} onClick={sendToPayment} className={`${base} bg-blue-600 text-white hover:bg-blue-700`}>Передать счёт на оплату</button>;
    if (status === 'WAITING_PAYMENT') return <button disabled={busy} onClick={confirmPayment} className={`${base} bg-blue-600 text-white hover:bg-blue-700`}>Подтвердить оплату</button>;
    if (status === 'WAITING_SHIPMENT') return <button onClick={() => { setShippedAt(toDateTimeLocal(new Date().toISOString())); setCarrier(''); setTrackingNumber(''); setExpectedDeliveryAt(''); setShipModalOpen(true); }} className={`${base} bg-blue-600 text-white hover:bg-blue-700`}>Подтвердить отгрузку</button>;
    if (status === 'IN_TRANSIT') return <button disabled={busy} onClick={readyForPickup} className={`${base} bg-blue-600 text-white hover:bg-blue-700`}>Груз прибыл</button>;
    if (status === 'READY_FOR_PICKUP') return <button disabled={busy} onClick={receiveOrder} className={`${base} bg-blue-600 text-white hover:bg-blue-700`}>Подтвердить получение</button>;
    if (status === 'RECEIVED') return <button onClick={() => setHandOverModalOpen(true)} className={`${base} bg-blue-600 text-white hover:bg-blue-700`}>Передать товар</button>;
    if (status === 'HANDED_OVER') return <button disabled={busy} onClick={closeOrder} className={`${base} bg-slate-950 text-white hover:bg-slate-800`}>Закрыть закупку</button>;
    if (status === 'CLOSED') return <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-700">Закупка завершена</div>;
    return null;
  }

  if (loading) return <AppShell title="Закупка"><div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Загружаем карточку...</div></AppShell>;
  if (loadError || !task) return <AppShell title="Закупка"><div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700">{loadError || 'Закупка не найдена'}</div></AppShell>;

  const lockedItemIds = new Set((task.purchaseOrders ?? [])
    .filter(order => !order.cancelledAt)
    .flatMap(order => (order.items ?? []).map(line => line.taskItemId)));
  const itemLocked = (id: string) => lockedItemIds.has(id) || task.status === 'CLOSED' || task.status === 'CANCELLED';

  const tabDefs: Array<[Tab, string, number | null]> = [
    ['overview', 'Обзор', null], ['items', 'Позиции', task.items.length], ['offers', 'Предложения', task.supplierOffers.length], ['order', 'Заказы', task.purchaseOrders?.length ?? 0], ['history', 'История', task.activities.length],
  ];

  return (
    <AppShell
      title={`№${task.number} · ${task.title}`}
      subtitle={task.description || 'Карточка закупки'}
      action={<Link href="/" className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">← К списку</Link>}
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusTone[task.status] ?? 'bg-slate-100 text-slate-700'}`}>{statusLabels[task.status] ?? task.status}</span>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${['URGENT','HIGH'].includes(task.priority) ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{priorityLabels[task.priority] ?? task.priority}</span>
        {task.deadline && <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">Срок {formatDateTime(task.deadline)}</span>}
      </div>

      {(message || actionError) && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${actionError ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{actionError || message}</div>}

      <div className="mb-6 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-1 shadow-sm">
        <div className="flex min-w-max gap-1">{tabDefs.map(([value, label, count]) => <button key={value} onClick={() => setActiveTab(value)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${activeTab === value ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}>{label}{count !== null && <span className="ml-1.5 rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-slate-400">{count}</span>}</button>)}</div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50 to-white p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">Текущее действие</div>
              <div className="mt-1.5 text-lg font-semibold text-slate-950">{task.nextAction || (task.status === 'CLOSED' ? 'Закупка завершена' : 'Действие не задано')}</div>
              {task.reminderAt && <div className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-500"><span aria-hidden="true">◷</span><span>Напоминание: {formatDateTime(task.reminderAt)}</span></div>}
              <div className="mt-4"><CurrentAction /></div>
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-5"><h2 className="font-semibold">Основная информация</h2><p className="mt-1 text-sm text-slate-500">Приоритет и напоминание по текущей закупке</p></div>
              <form onSubmit={saveOverview} className="grid gap-4 md:grid-cols-2">
                <label><span className="mb-1.5 block text-sm font-medium">Приоритет</span><select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm"><option value="LOW">Низкий</option><option value="NORMAL">Обычный</option><option value="HIGH">Высокий</option><option value="URGENT">Срочный</option></select></label>
                <label><span className="mb-1.5 block text-sm font-medium">Напоминание</span><input type="datetime-local" value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm" /></label>
                {editNextAction && <label className="md:col-span-2"><span className="mb-1.5 block text-sm font-medium">Следующее действие</span><textarea rows={2} value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="w-full resize-none rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-400" /><p className="mt-1.5 text-xs text-slate-400">Обычно действие меняется автоматически при переходе между этапами. Редактируйте его вручную только при необходимости.</p></label>}
                <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <button type="button" onClick={() => setEditNextAction((value) => !value)} className="text-sm font-medium text-slate-500 transition hover:text-blue-700">{editNextAction ? 'Скрыть ручное редактирование' : 'Изменить следующее действие'}</button>
                  <button disabled={busy} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Сохранить изменения</button>
                </div>
              </form>
            </section>
          </div>

          <aside className="space-y-5 xl:sticky xl:top-5">
            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="font-semibold">Ход закупки</h2><p className="mt-1 text-sm text-slate-500">Главные этапы от заявки до закрытия</p></div><span className="shrink-0 text-xs text-slate-400">{progress.filter((x) => x[2]).length}/{progress.length}</span></div>
              <div>
                {progress.map(([label, date, done], index) => {
                  const isCurrent = !done && index === currentProgressIndex && task.status !== 'CANCELLED';
                  const displayLabel = isCurrent && currentProgressLabel ? currentProgressLabel : label;
                  return <div key={label} className="relative flex gap-3 pb-4 last:pb-0">
                    <div className="relative flex w-6 shrink-0 justify-center">
                      <div className={`z-10 mt-0.5 grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${done ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-blue-600 text-white ring-4 ring-blue-50' : 'border-2 border-slate-200 bg-white text-slate-300'}`}>{done ? '✓' : index + 1}</div>
                      {index < progress.length - 1 && <div className={`absolute top-6 h-[calc(100%_-_2px)] w-px ${done ? 'bg-emerald-200' : isCurrent ? 'bg-blue-100' : 'bg-slate-200'}`} />}
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <div className={`text-sm font-medium ${done ? 'text-slate-900' : isCurrent ? 'font-semibold text-blue-700' : 'text-slate-400'}`}>{displayLabel}</div>
                      {isCurrent && <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-500">Текущий этап</div>}
                      {date && <div className="mt-0.5 text-xs text-slate-400">{formatDateTime(date)}</div>}
                    </div>
                  </div>;
                })}
              </div>
            </section>
            {!legacyMode && (task.purchaseOrders?.length ?? 0) > 0 && <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold">Заказы поставщикам</h3>
              <p className="mt-2 text-sm text-slate-500">Действующих: {(task.purchaseOrders ?? []).filter(o => !o.cancelledAt).length} · Всего с отменёнными: {task.purchaseOrders?.length ?? 0}</p>
              <button onClick={() => setActiveTab('order')} className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">Открыть все заказы</button>
            </section>}
            {legacyMode && task.purchaseOrder && <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><div className="text-sm font-semibold">Заказ и логистика</div><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-400">Поставщик</dt><dd className="text-right font-medium">{task.purchaseOrder.supplier.name}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-400">Счёт</dt><dd className="text-right font-medium">{task.purchaseOrder.invoiceNumber || '—'}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-400">Сумма</dt><dd className="text-right font-medium">{formatMoney(task.purchaseOrder.totalPrice)}</dd></div>{task.purchaseOrder.carrier && <div className="flex justify-between gap-4"><dt className="text-slate-400">Перевозчик</dt><dd className="text-right font-medium">{task.purchaseOrder.carrier}</dd></div>}{task.purchaseOrder.trackingNumber && <div className="flex justify-between gap-4"><dt className="text-slate-400">Трек / ТТН</dt><dd className="text-right font-medium text-blue-700">{task.purchaseOrder.trackingNumber}</dd></div>}</dl><button onClick={() => setActiveTab('order')} className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">Открыть заказ</button></section>}
          </aside>
        </div>
      )}

      {activeTab === 'items' && (
        <section className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Позиции закупки</h2>
              <p className="mt-1 text-sm text-slate-500">
                Номенклатура, количество и ориентировочная стоимость закупки
              </p>
            </div>
            <button
              onClick={openNewItem} disabled={task.status === 'CLOSED' || task.status === 'CANCELLED'}
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              ＋ Добавить позицию
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-400">Всего позиций</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">{itemsSummary.total}</div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-400">Ориентировочная сумма</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">
                {itemsSummary.priced > 0 ? formatMoney(itemsSummary.amount) : '—'}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-400">С указанной ценой</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-emerald-600">{itemsSummary.priced}</span>
                <span className="text-xs text-slate-400">из {itemsSummary.total}</span>
              </div>
            </div>
            <div className={`rounded-2xl border p-4 shadow-sm ${itemsSummary.withoutPrice > 0 ? 'border-amber-100 bg-amber-50/60' : 'border-slate-200/80 bg-white'}`}>
              <div className={`text-xs font-medium ${itemsSummary.withoutPrice > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                Без ориентировочной цены
              </div>
              <div className={`mt-1 text-2xl font-semibold ${itemsSummary.withoutPrice > 0 ? 'text-amber-700' : 'text-slate-950'}`}>
                {itemsSummary.withoutPrice}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-sm">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">⌕</span>
                <input
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                  placeholder="Найти по названию, артикулу или примечанию"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3.5 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
                />
              </div>
              {task.items.length > 0 && (
                <div className="text-xs text-slate-400">
                  {itemSearch.trim()
                    ? `Найдено: ${filteredItems.length} из ${task.items.length}`
                    : `${task.items.length} ${task.items.length === 1 ? 'позиция' : task.items.length < 5 ? 'позиции' : 'позиций'}`}
                </div>
              )}
            </div>

            {task.items.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-xl text-blue-600">≡</div>
                <div className="mt-4 font-semibold text-slate-900">Позиции ещё не добавлены</div>
                <div className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                  Добавьте комплектующие, материалы или другие позиции, которые необходимо закупить.
                </div>
                <button onClick={openNewItem} className="mt-5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                  Добавить первую позицию
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="font-semibold text-slate-900">Ничего не найдено</div>
                <div className="mt-1 text-sm text-slate-500">Попробуйте изменить поисковый запрос.</div>
                <button onClick={() => setItemSearch('')} className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700">
                  Сбросить поиск
                </button>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-slate-50/80 text-xs font-medium text-slate-400">
                      <tr>
                        <th className="px-5 py-3">Позиция</th>
                        <th className="px-5 py-3">Количество</th>
                        <th className="px-5 py-3">Цена за ед.</th>
                        <th className="px-5 py-3">Сумма</th>
                        <th className="px-5 py-3 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredItems.map((item) => {
                        const total = itemTotal(item);
                        return (
                          <tr key={item.id} className="group transition hover:bg-slate-50/70">
                            <td className="px-5 py-4">
                              <div className="max-w-xl">
                                <div className="font-semibold text-slate-900">{item.name}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                  {item.partNumber ? (
                                    <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600">{item.partNumber}</span>
                                  ) : (
                                    <span className="text-slate-400">Без артикула</span>
                                  )}
                                  {item.notes && <span className="text-slate-400">· {item.notes}</span>}
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-700">
                              {formatQuantity(item.quantity)} <span className="font-normal text-slate-400">{item.unit}</span>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              {item.unitPrice === null ? (
                                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Не указана</span>
                              ) : (
                                <span className="text-slate-700">{formatMoney(item.unitPrice, item.currency || 'RUB')}</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-950">
                              {total === null ? '—' : formatMoney(total, item.currency || 'RUB')}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-right">
                              <button disabled={itemLocked(item.id)} title={itemLocked(item.id) ? 'Позиция уже в действующем заказе или закупка закрыта' : undefined} onClick={() => openEditItem(item)} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-blue-600 transition hover:bg-blue-50">
                                Изменить
                              </button>
                              <button disabled={itemLocked(item.id)} title={itemLocked(item.id) ? 'Позиция уже в действующем заказе или закупка закрыта' : undefined} onClick={() => void deleteItem(item)} className="ml-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
                                Удалить
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {itemsSummary.priced > 0 && !itemSearch.trim() && (
                      <tfoot className="border-t border-slate-200 bg-slate-50/60">
                        <tr>
                          <td colSpan={3} className="px-5 py-4 text-sm font-medium text-slate-500">
                            Ориентировочная стоимость позиций с указанной ценой
                          </td>
                          <td className="px-5 py-4 text-base font-semibold text-slate-950">{formatMoney(itemsSummary.amount)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                <div className="divide-y divide-slate-100 md:hidden">
                  {filteredItems.map((item) => {
                    const total = itemTotal(item);
                    return (
                      <article key={item.id} className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900">{item.name}</div>
                            <div className="mt-1 text-xs text-slate-400">{item.partNumber || 'Без артикула'}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-semibold text-slate-950">{total === null ? '—' : formatMoney(total, item.currency || 'RUB')}</div>
                            <div className="mt-1 text-xs text-slate-400">{formatQuantity(item.quantity)} {item.unit}</div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          {item.unitPrice === null ? (
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">Цена не указана</span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{formatMoney(item.unitPrice, item.currency || 'RUB')} / {item.unit}</span>
                          )}
                        </div>

                        {item.notes && <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-500">{item.notes}</div>}

                        <div className="mt-4 flex gap-2">
                          <button disabled={itemLocked(item.id)} title={itemLocked(item.id) ? 'Позиция уже в действующем заказе или закупка закрыта' : undefined} onClick={() => openEditItem(item)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                            Изменить
                          </button>
                          <button disabled={itemLocked(item.id)} title={itemLocked(item.id) ? 'Позиция уже в действующем заказе или закупка закрыта' : undefined} onClick={() => void deleteItem(item)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400" aria-label={`Удалить ${item.name}`}>
                            Удалить
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {activeTab === 'offers' && legacyMode && (
        <section className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Предложения поставщиков</h2>
              <p className="mt-1 text-sm text-slate-500">
                Сравните стоимость, сроки и наличие перед оформлением заказа
              </p>
            </div>
            <button
              onClick={() => setSupplierFormOpen(true)}
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              ＋ Добавить предложение
            </button>
          </div>

          {task.supplierOffers.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-400">Получено предложений</div>
                <div className="mt-1 text-2xl font-semibold text-slate-950">{task.supplierOffers.length}</div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-400">Лучшая стоимость</div>
                <div className="mt-1 text-xl font-semibold text-slate-950">
                  {offerComparison.bestTotalId
                    ? formatMoney(
                        offerTotal(
                          task.supplierOffers.find((offer) => offer.id === offerComparison.bestTotalId)!,
                        ),
                      )
                    : '—'}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-400">Минимальный срок</div>
                <div className="mt-1 text-xl font-semibold text-slate-950">
                  {offerComparison.fastestId
                    ? `${task.supplierOffers.find((offer) => offer.id === offerComparison.fastestId)?.deliveryDays} дн.`
                    : '—'}
                </div>
              </div>

              <div className={`rounded-2xl border p-4 shadow-sm ${offerComparison.inStockCount > 0 ? 'border-emerald-100 bg-emerald-50/50' : 'border-slate-200/80 bg-white'}`}>
                <div className={`text-xs font-medium ${offerComparison.inStockCount > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                  В наличии
                </div>
                <div className={`mt-1 text-2xl font-semibold ${offerComparison.inStockCount > 0 ? 'text-emerald-700' : 'text-slate-950'}`}>
                  {offerComparison.inStockCount}
                </div>
              </div>
            </div>
          )}

          {task.supplierOffers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-xl text-blue-600">₽</div>
              <div className="mt-4 font-semibold text-slate-900">Предложений пока нет</div>
              <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Добавьте полученные коммерческие предложения, чтобы сравнить поставщиков по цене, сроку и наличию.
              </div>
              <button
                onClick={() => setSupplierFormOpen(true)}
                className="mt-5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Добавить первое предложение
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Сравнение предложений</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Лучшие условия отмечаются автоматически, решение остаётся за снабжением
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="shrink-0">Сортировка</span>
                  <select
                    value={offerSort}
                    onChange={(event) =>
                      setOfferSort(event.target.value as 'total' | 'delivery' | 'recent')
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-blue-400"
                  >
                    <option value="total">По итоговой стоимости</option>
                    <option value="delivery">По сроку поставки</option>
                    <option value="recent">Сначала новые</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {offerComparison.sorted.map((offer) => {
                  const selected = task.selectedOfferId === offer.id;
                  const bestPrice = offerComparison.bestTotalId === offer.id;
                  const fastest = offerComparison.fastestId === offer.id;
                  const totalKnown = offer.price !== null;

                  return (
                    <article
                      key={offer.id}
                      className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm transition ${
                        selected
                          ? 'border-blue-300 ring-2 ring-blue-100'
                          : 'border-slate-200/80 hover:border-slate-300'
                      }`}
                    >
                      {selected && <div className="absolute inset-x-0 top-0 h-1 bg-blue-600" />}

                      <div className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-base font-semibold text-slate-950">
                                {offer.supplier.name}
                              </h3>
                              {selected && (
                                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                                  Выбран
                                </span>
                              )}
                            </div>

                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                              {offer.supplier.contact && <span>{offer.supplier.contact}</span>}
                              {offer.supplier.phone && <span>{offer.supplier.phone}</span>}
                              {offer.supplier.email && <span>{offer.supplier.email}</span>}
                              {!offer.supplier.contact && !offer.supplier.phone && !offer.supplier.email && (
                                <span>Контактные данные не указаны</span>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            {bestPrice && (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                Лучшая цена
                              </span>
                            )}
                            {fastest && (
                              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                                Быстрее всех
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-[11px] font-medium text-slate-400">Товар</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(offer.price)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-[11px] font-medium text-slate-400">Доставка</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(offer.deliveryPrice)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-[11px] font-medium text-slate-400">Срок</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">
                              {offer.deliveryDays !== null ? `${offer.deliveryDays} дн.` : '—'}
                            </div>
                          </div>
                          <div className={`rounded-xl p-3 ${offer.inStock === true ? 'bg-emerald-50' : offer.inStock === false ? 'bg-amber-50' : 'bg-slate-50'}`}>
                            <div className={`text-[11px] font-medium ${offer.inStock === true ? 'text-emerald-600' : offer.inStock === false ? 'text-amber-600' : 'text-slate-400'}`}>
                              Наличие
                            </div>
                            <div className={`mt-1 text-sm font-semibold ${offer.inStock === true ? 'text-emerald-700' : offer.inStock === false ? 'text-amber-700' : 'text-slate-900'}`}>
                              {offer.inStock === true ? 'В наличии' : offer.inStock === false ? 'Под заказ' : 'Не указано'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-col gap-4 border-t border-slate-100 pt-4 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <div className="text-xs text-slate-400">Итоговая стоимость</div>
                            <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                              {totalKnown ? formatMoney(offerTotal(offer)) : 'Цена не указана'}
                            </div>
                            {totalKnown && offer.deliveryPrice === null && (
                              <div className="mt-1 text-[11px] text-slate-400">Без учёта неуказанной доставки</div>
                            )}
                          </div>

                          {!task.purchaseOrder && (
                            <button
                              disabled={selected || busy}
                              onClick={() => void selectOffer(offer)}
                              className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                                selected
                                  ? 'cursor-default bg-blue-50 text-blue-600'
                                  : 'border border-slate-200 text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
                              }`}
                            >
                              {selected ? '✓ Поставщик выбран' : 'Выбрать поставщика'}
                            </button>
                          )}
                        </div>

                        {offer.notes && (
                          <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-500">
                            <span className="font-medium text-slate-600">Комментарий: </span>
                            {offer.notes}
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                          <span>
                            Получено: {formatDateTime(offer.receivedAt ?? offer.requestedAt)}
                          </span>
                          {offer.supplier.website && (
                            <span className="max-w-[260px] truncate">
                              {offer.supplier.website}
                            </span>
                          )}
                        </div>

                        {selected && !task.purchaseOrder && (
                          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">
                                  Выбранное предложение
                                </div>
                                <div className="mt-1 text-sm text-blue-950">
                                  Следующий шаг — оформить заказ и зафиксировать счёт.
                                </div>
                              </div>
                              <button
                                onClick={() => setOrderFormOpen(true)}
                                className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                              >
                                Оформить заказ →
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === 'order' && legacyMode && (
        <section className="space-y-5">
          {!task.purchaseOrder ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-xl text-blue-600">▣</div>
              <div className="mt-4 font-semibold text-slate-900">Заказ ещё не оформлен</div>
              <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {task.selectedOffer
                  ? `Поставщик «${task.selectedOffer.supplier.name}» уже выбран. Осталось зафиксировать счёт и оформить заказ.`
                  : 'Сначала сравните предложения и выберите поставщика, у которого будет оформлен заказ.'}
              </div>
              <button
                onClick={() => {
                  if (task.selectedOffer) {
                    setOrderFormOpen(true);
                  } else {
                    setActiveTab('offers');
                  }
                }}
                className="mt-5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {task.selectedOffer ? 'Оформить заказ' : 'К предложениям'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-950">Текущий заказ</h2>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone[task.status] ?? 'bg-slate-100 text-slate-700'}`}>
                      {statusLabels[task.status] ?? task.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {task.purchaseOrder.supplier.name}
                    {task.purchaseOrder.invoiceNumber ? ` · счёт № ${task.purchaseOrder.invoiceNumber}` : ''}
                  </p>
                </div>

                {task.purchaseOrders && task.purchaseOrders.length > 1 && (
                  <div className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
                    Попыток заказа: {task.purchaseOrders.length}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                  <div className="text-xs font-medium text-slate-400">Сумма заказа</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {formatMoney(task.purchaseOrder.totalPrice)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                  <div className="text-xs font-medium text-slate-400">Счёт</div>
                  <div className="mt-1 truncate text-xl font-semibold text-slate-950">
                    {task.purchaseOrder.invoiceNumber || '—'}
                  </div>
                  {task.purchaseOrder.invoiceDate && (
                    <div className="mt-1 text-xs text-slate-400">{formatDateTime(task.purchaseOrder.invoiceDate)}</div>
                  )}
                </div>

                <div className={`rounded-2xl border p-4 shadow-sm ${task.purchaseOrder.paidAt ? 'border-emerald-100 bg-emerald-50/50' : 'border-slate-200/80 bg-white'}`}>
                  <div className={`text-xs font-medium ${task.purchaseOrder.paidAt ? 'text-emerald-600' : 'text-slate-400'}`}>
                    Оплата
                  </div>
                  <div className={`mt-1 text-xl font-semibold ${task.purchaseOrder.paidAt ? 'text-emerald-700' : 'text-slate-950'}`}>
                    {task.purchaseOrder.paidAt ? 'Оплачено' : task.purchaseOrder.sentToPaymentAt ? 'Ожидается' : 'Не передан'}
                  </div>
                  {(task.purchaseOrder.paidAt || task.purchaseOrder.sentToPaymentAt) && (
                    <div className="mt-1 text-xs text-slate-400">
                      {formatDateTime(task.purchaseOrder.paidAt || task.purchaseOrder.sentToPaymentAt)}
                    </div>
                  )}
                </div>

                <div className={`rounded-2xl border p-4 shadow-sm ${task.purchaseOrder.shippedAt ? 'border-blue-100 bg-blue-50/50' : 'border-slate-200/80 bg-white'}`}>
                  <div className={`text-xs font-medium ${task.purchaseOrder.shippedAt ? 'text-blue-600' : 'text-slate-400'}`}>
                    Доставка
                  </div>
                  <div className={`mt-1 text-xl font-semibold ${task.purchaseOrder.shippedAt ? 'text-blue-700' : 'text-slate-950'}`}>
                    {task.purchaseOrder.receivedAt
                      ? 'Получено'
                      : task.purchaseOrder.readyForPickupAt
                        ? 'Прибыло'
                        : task.purchaseOrder.shippedAt
                          ? 'В пути'
                          : 'Не отгружено'}
                  </div>
                  {task.purchaseOrder.expectedDeliveryAt && !task.purchaseOrder.receivedAt && (
                    <div className="mt-1 text-xs text-slate-400">
                      Ожидается {formatDateTime(task.purchaseOrder.expectedDeliveryAt)}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                  <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                    <div className="border-b border-slate-100 px-5 py-4">
                      <h3 className="font-semibold text-slate-950">Финансы и счёт</h3>
                      <p className="mt-1 text-sm text-slate-500">Зафиксированные условия заказа и состояние оплаты</p>
                    </div>

                    <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
                      <div className="bg-white p-5">
                        <div className="text-xs font-medium text-slate-400">Поставщик</div>
                        <div className="mt-1.5 font-semibold text-slate-900">{task.purchaseOrder.supplier.name}</div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                          {task.purchaseOrder.supplier.contact && <span>{task.purchaseOrder.supplier.contact}</span>}
                          {task.purchaseOrder.supplier.phone && <span>{task.purchaseOrder.supplier.phone}</span>}
                          {task.purchaseOrder.supplier.email && <span>{task.purchaseOrder.supplier.email}</span>}
                        </div>
                      </div>

                      <div className="bg-white p-5">
                        <div className="text-xs font-medium text-slate-400">Стоимость</div>
                        <div className="mt-1.5 text-xl font-semibold text-slate-950">
                          {formatMoney(task.purchaseOrder.totalPrice)}
                        </div>
                        <div className="mt-2 text-xs text-slate-400">
                          Товар {formatMoney(task.purchaseOrder.price)} · доставка {formatMoney(task.purchaseOrder.deliveryPrice)}
                        </div>
                      </div>

                      <div className="bg-white p-5">
                        <div className="text-xs font-medium text-slate-400">Счёт</div>
                        <div className="mt-1.5 font-semibold text-slate-900">
                          {task.purchaseOrder.invoiceNumber ? `№ ${task.purchaseOrder.invoiceNumber}` : 'Номер не указан'}
                        </div>
                        <div className="mt-2 text-xs text-slate-400">
                          {task.purchaseOrder.invoiceDate ? `от ${formatDateTime(task.purchaseOrder.invoiceDate)}` : 'Дата не указана'}
                        </div>
                      </div>

                      <div className="bg-white p-5">
                        <div className="text-xs font-medium text-slate-400">Оплата</div>
                        <div className="mt-1.5 font-semibold text-slate-900">
                          {task.purchaseOrder.paidAt
                            ? 'Оплата подтверждена'
                            : task.purchaseOrder.sentToPaymentAt
                              ? 'Счёт передан на оплату'
                              : 'Счёт ещё не передан на оплату'}
                        </div>
                        <div className="mt-2 text-xs text-slate-400">
                          {task.purchaseOrder.paidAt
                            ? formatDateTime(task.purchaseOrder.paidAt)
                            : task.purchaseOrder.sentToPaymentAt
                              ? formatDateTime(task.purchaseOrder.sentToPaymentAt)
                              : `Заказ оформлен ${formatDateTime(task.purchaseOrder.orderedAt)}`}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-950">Логистика</h3>
                        <p className="mt-1 text-sm text-slate-500">Отгрузка, перевозчик и движение груза</p>
                      </div>
                      {task.purchaseOrder.trackingNumber && (
                        <span className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700">
                          ТТН {task.purchaseOrder.trackingNumber}
                        </span>
                      )}
                    </div>

                    {!task.purchaseOrder.shippedAt ? (
                      <div className="mt-5 rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                        Данные доставки появятся после подтверждения отгрузки поставщиком.
                      </div>
                    ) : (
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <Info label="Дата отгрузки" value={formatDateTime(task.purchaseOrder.shippedAt)} />
                        <Info label="Перевозчик" value={task.purchaseOrder.carrier || '—'} />
                        <Info label="Трек / ТТН" value={task.purchaseOrder.trackingNumber || '—'} />
                        <Info label="Ожидаемое прибытие" value={formatDateTime(task.purchaseOrder.expectedDeliveryAt)} />
                        <Info label="Готово к получению" value={formatDateTime(task.purchaseOrder.readyForPickupAt)} />
                        <Info label="Фактически получено" value={formatDateTime(task.purchaseOrder.receivedAt)} />
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                    <div>
                      <h3 className="font-semibold text-slate-950">Получение и передача</h3>
                      <p className="mt-1 text-sm text-slate-500">Фиксация передачи закупленного товара конечному получателю</p>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <Info label="Товар получен" value={formatDateTime(task.purchaseOrder.receivedAt)} />
                      <Info label="Передан" value={formatDateTime(task.purchaseOrder.handedOverAt)} />
                      <Info label="Кому передан" value={task.purchaseOrder.handedOverTo || '—'} />
                      <Info label="Закупка закрыта" value={formatDateTime(task.closedAt)} />
                    </div>
                  </section>

                  {task.purchaseOrder.notes && (
                    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Примечание к заказу</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {task.purchaseOrder.notes}
                      </div>
                    </section>
                  )}

                  {task.purchaseOrders && task.purchaseOrders.filter((order) => order.id !== task.purchaseOrder?.id).length > 0 && (
                    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                      <h3 className="font-semibold text-slate-950">Предыдущие попытки заказа</h3>
                      <p className="mt-1 text-sm text-slate-500">Отменённые заказы сохраняются в истории закупки</p>

                      <div className="mt-4 divide-y divide-slate-100">
                        {task.purchaseOrders
                          .filter((order) => order.id !== task.purchaseOrder?.id)
                          .map((order) => (
                            <div key={order.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <div className="text-sm font-medium text-slate-800">{order.supplier.name}</div>
                                <div className="mt-0.5 text-xs text-slate-400">
                                  {order.invoiceNumber ? `Счёт № ${order.invoiceNumber}` : 'Без номера счёта'} · {formatDateTime(order.orderedAt)}
                                </div>
                              </div>
                              <div className="text-left sm:text-right">
                                <div className="text-sm font-semibold text-slate-700">{formatMoney(order.totalPrice)}</div>
                                <div className="mt-0.5 text-xs text-rose-500">
                                  {order.cancelReason ? `Отменён: ${order.cancelReason}` : 'Предыдущий заказ'}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    </section>
                  )}
                </div>

                <aside className="space-y-4 xl:sticky xl:top-5">
                  <section className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50 to-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">Следующий шаг</div>
                    <div className="mt-2 text-lg font-semibold text-slate-950">
                      {task.nextAction || (task.status === 'CLOSED' ? 'Закупка завершена' : 'Действие не задано')}
                    </div>
                    {task.reminderAt && (
                      <div className="mt-2 text-sm text-slate-500">
                        Напоминание: {formatDateTime(task.reminderAt)}
                      </div>
                    )}
                    <div className="mt-5">
                      <CurrentAction />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="font-semibold text-slate-950">Этапы заказа</h3>
                      <span className="text-xs text-slate-400">
                        {orderFlow.filter((step) => step.done).length}/{orderFlow.length}
                      </span>
                    </div>

                    <div>
                      {orderFlow.map((step, index) => {
                        const current = !step.done && index === currentOrderStepIndex && task.status !== 'CANCELLED';
                        return (
                          <div key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                            <div className="relative flex w-6 shrink-0 justify-center">
                              <div className={`z-10 mt-0.5 grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${
                                step.done
                                  ? 'bg-emerald-500 text-white'
                                  : current
                                    ? 'bg-blue-600 text-white ring-4 ring-blue-50'
                                    : 'border-2 border-slate-200 bg-white text-slate-300'
                              }`}>
                                {step.done ? '✓' : index + 1}
                              </div>
                              {index < orderFlow.length - 1 && (
                                <div className={`absolute top-6 h-[calc(100%_-_2px)] w-px ${
                                  step.done ? 'bg-emerald-200' : current ? 'bg-blue-100' : 'bg-slate-200'
                                }`} />
                              )}
                            </div>

                            <div className="min-w-0 pt-0.5">
                              <div className={`text-sm font-medium ${
                                step.done ? 'text-slate-900' : current ? 'font-semibold text-blue-700' : 'text-slate-400'
                              }`}>
                                {step.label}
                              </div>
                              {current && (
                                <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-500">
                                  Текущий этап
                                </div>
                              )}
                              {step.date && (
                                <div className="mt-0.5 text-xs text-slate-400">{formatDateTime(step.date)}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {!task.purchaseOrder.paidAt && (
                    <button
                      onClick={() => setCancelModalOpen(true)}
                      className="w-full rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      Отменить заказ / сменить поставщика
                    </button>
                  )}
                </aside>
              </div>
            </>
          )}
        </section>
      )}

      {!legacyMode && (activeTab === 'offers' || activeTab === 'order') && (
        <ProcurementWorkspace
          task={task}
          mode={activeTab === 'offers' ? 'offers' : 'orders'}
          busy={busy}
          onAction={apiAction}
          onNavigate={(next) => setActiveTab(next === 'orders' ? 'order' : 'offers')}
        />
      )}

      {activeTab === 'history' && (
        <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-950">История закупки</h2>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                      {task.activities.length}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Хронология решений, действий и рабочих заметок по закупке
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {([
                    ['all', `Все · ${task.activities.length}`],
                    ['events', `События · ${historyData.eventCount}`],
                    ['notes', `Заметки · ${historyData.noteCount}`],
                  ] as Array<[HistoryFilter, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setHistoryFilter(value)}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        historyFilter === value
                          ? 'bg-slate-950 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative mt-4">
                <span
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                >
                  ⌕
                </span>
                <input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Найти событие или заметку"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3.5 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
                />
              </div>
            </div>

            {task.activities.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-xl text-blue-600">
                  ↻
                </div>
                <div className="mt-4 font-semibold text-slate-900">История пока пуста</div>
                <div className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                  Системные события будут появляться здесь автоматически. Рабочие комментарии можно добавлять вручную.
                </div>
              </div>
            ) : historyData.filtered.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <div className="font-semibold text-slate-900">Ничего не найдено</div>
                <div className="mt-1 text-sm text-slate-500">
                  Измените фильтр или поисковый запрос.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryFilter('all');
                    setHistorySearch('');
                  }}
                  className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  Показать всю историю
                </button>
              </div>
            ) : (
              <div className="p-5">
                {historyData.grouped.map((group, groupIndex) => (
                  <div key={group.date} className={groupIndex > 0 ? 'mt-7' : ''}>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {group.date}
                      </div>
                      <div className="h-px flex-1 bg-slate-100" />
                    </div>

                    <div className="space-y-3">
                      {group.activities.map((activity) => {
                        const meta = getActivityMeta(activity.text);

                        return (
                          <article
                            key={activity.id}
                            className="group flex gap-3 rounded-2xl border border-transparent p-2 transition hover:border-slate-100 hover:bg-slate-50/70"
                          >
                            <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold ${meta.dotClass}`}>
                              {meta.icon}
                            </div>

                            <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${meta.badgeClass}`}>
                                  {meta.label}
                                </span>
                                <time className="text-xs font-medium text-slate-400">
                                  {formatHistoryTime(activity.createdAt)}
                                </time>
                              </div>

                              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                                {activity.text}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-5">
            <form
              onSubmit={addActivity}
              className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">Добавить заметку</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Для договорённостей, звонков и промежуточных решений
                  </p>
                </div>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-50 font-semibold text-cyan-600">
                  ＋
                </div>
              </div>

              <textarea
                value={activityText}
                onChange={(event) => setActivityText(event.target.value)}
                rows={5}
                placeholder="Например: поставщик подтвердил наличие, ждём уточнение по сроку доставки..."
                className="mt-4 w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-sm leading-6 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
              />

              <div className="mt-3 flex flex-wrap gap-1.5">
                {[
                  'Связались с поставщиком',
                  'Ожидаем ответ',
                  'Запрошено уточнение',
                ].map((template) => (
                  <button
                    key={template}
                    type="button"
                    onClick={() =>
                      setActivityText((current) =>
                        current.trim() ? `${current.trim()}\n${template}` : template,
                      )
                    }
                    className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                  >
                    {template}
                  </button>
                ))}
              </div>

              <button
                disabled={busy || !activityText.trim()}
                className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Добавляем...' : 'Добавить в историю'}
              </button>
            </form>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-slate-950">Сводка</h3>

              <dl className="mt-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-sm text-slate-400">Создана</dt>
                  <dd className="text-right text-sm font-medium text-slate-700">
                    {formatDateTime(task.createdAt)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-sm text-slate-400">Последнее изменение</dt>
                  <dd className="text-right text-sm font-medium text-slate-700">
                    {formatDateTime(task.updatedAt)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-sm text-slate-400">Событий</dt>
                  <dd className="text-right text-sm font-semibold text-slate-800">
                    {historyData.eventCount}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-sm text-slate-400">Заметок</dt>
                  <dd className="text-right text-sm font-semibold text-slate-800">
                    {historyData.noteCount}
                  </dd>
                </div>
                <div className="border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-sm text-slate-400">Текущий этап</dt>
                    <dd>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[task.status] ?? 'bg-slate-100 text-slate-700'}`}>
                        {statusLabels[task.status] ?? task.status}
                      </span>
                    </dd>
                  </div>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Принцип истории
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Ключевые действия фиксируются автоматически, а заметки дополняют контекст. Так по карточке можно восстановить весь ход закупки без отдельного журнала.
              </p>
            </section>
          </aside>
        </section>
      )}

      {itemFormOpen && (
        <Modal title={editingItemId ? 'Изменить позицию' : 'Новая позиция'} onClose={() => setItemFormOpen(false)}>
          <form onSubmit={saveItem} className="space-y-4">
            <Field label="Наименование *">
              <input autoFocus value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Например: Подшипник 6205-2RS" className="input" />
            </Field>

            <Field label="Артикул / каталожный номер">
              <input value={itemPartNumber} onChange={(e) => setItemPartNumber(e.target.value)} placeholder="6205-2RS, DN40 PN25..." className="input" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Количество *">
                <input type="number" min="0.001" step="0.001" value={itemQuantity} onChange={(e) => setItemQuantity(e.target.value)} className="input" />
              </Field>
              <Field label="Ед. измерения *">
                <input value={itemUnit} onChange={(e) => setItemUnit(e.target.value)} placeholder="шт., кг, м..." list="task-item-units" className="input" />
                <datalist id="task-item-units">
                  <option value="шт." />
                  <option value="компл." />
                  <option value="кг" />
                  <option value="м" />
                  <option value="л" />
                  <option value="упак." />
                </datalist>
              </Field>
            </div>

            <Field label="Ориентировочная цена за единицу, ₽">
              <input type="number" min="0" step="0.01" value={itemUnitPrice} onChange={(e) => setItemUnitPrice(e.target.value)} placeholder="Можно оставить пустым" className="input" />
            </Field>

            {itemUnitPrice.trim() !== '' && Number(itemUnitPrice) >= 0 && Number(itemQuantity) > 0 && (
              <div className="flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3 text-sm">
                <span className="text-blue-600">Ориентировочная сумма</span>
                <span className="font-semibold text-blue-950">{formatMoney(Number(itemUnitPrice) * Number(itemQuantity))}</span>
              </div>
            )}

            <Field label="Примечание">
              <textarea rows={3} value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} placeholder="Характеристики, требования, производитель, аналог..." className="input resize-none" />
            </Field>

            <ModalActions busy={busy} onCancel={() => setItemFormOpen(false)} submitLabel={editingItemId ? 'Сохранить изменения' : 'Добавить позицию'} />
          </form>
        </Modal>
      )}

      {legacyMode && supplierFormOpen && (
        <Modal title="Новое предложение поставщика" onClose={() => setSupplierFormOpen(false)}>
          <form onSubmit={addSupplier} className="space-y-5">
            <div>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Поставщик
              </div>
              <div className="space-y-3">
                <Field label="Название поставщика *">
                  <input
                    autoFocus
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="ООО «Поставщик»"
                    className="input"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Контактное лицо">
                    <input value={supplierContact} onChange={(e) => setSupplierContact(e.target.value)} placeholder="Иванов Иван" className="input" />
                  </Field>
                  <Field label="Телефон">
                    <input value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} placeholder="+7 ..." className="input" />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} placeholder="sales@company.ru" className="input" />
                  </Field>
                  <Field label="Сайт">
                    <input value={supplierWebsite} onChange={(e) => setSupplierWebsite(e.target.value)} placeholder="company.ru" className="input" />
                  </Field>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Условия предложения
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Стоимость товара, ₽">
                  <input type="number" min="0" step="0.01" value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} placeholder="0,00" className="input" />
                </Field>
                <Field label="Доставка, ₽">
                  <input type="number" min="0" step="0.01" value={deliveryPrice} onChange={(e) => setDeliveryPrice(e.target.value)} placeholder="0,00" className="input" />
                </Field>
                <Field label="Срок, дней">
                  <input type="number" min="0" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} placeholder="Например, 5" className="input" />
                </Field>
              </div>

              {(offerPrice.trim() !== '' || deliveryPrice.trim() !== '') && (
                <div className="mt-3 flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3 text-sm">
                  <span className="text-blue-600">Итоговая стоимость</span>
                  <span className="font-semibold text-blue-950">
                    {formatMoney(Number(offerPrice || 0) + Number(deliveryPrice || 0))}
                  </span>
                </div>
              )}

              <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">Товар в наличии</div>
                  <div className="mt-0.5 text-xs text-slate-400">Можно отгрузить без ожидания производства или поставки</div>
                </div>
                <input
                  type="checkbox"
                  checked={inStock}
                  onChange={(e) => setInStock(e.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
              </label>
            </div>

            <Field label="Комментарий к предложению">
              <textarea
                rows={3}
                value={supplierNotes}
                onChange={(e) => setSupplierNotes(e.target.value)}
                placeholder="Условия оплаты, особенности доставки, аналоги, ограничения..."
                className="input resize-none"
              />
            </Field>

            <ModalActions
              busy={busy}
              onCancel={() => setSupplierFormOpen(false)}
              submitLabel="Добавить предложение"
            />
          </form>
        </Modal>
      )}

      {legacyMode && orderFormOpen && task.selectedOffer && (
        <Modal title={`Оформить заказ у «${task.selectedOffer.supplier.name}»`} onClose={() => setOrderFormOpen(false)}>
          <form onSubmit={createOrder} className="space-y-5">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">Выбранное предложение</div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-blue-500/80">Итого</div>
                  <div className="mt-1 font-semibold text-blue-950">{formatMoney(offerTotal(task.selectedOffer))}</div>
                </div>
                <div>
                  <div className="text-xs text-blue-500/80">Срок</div>
                  <div className="mt-1 font-semibold text-blue-950">
                    {task.selectedOffer.deliveryDays !== null ? `${task.selectedOffer.deliveryDays} дн.` : '—'}
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <div className="text-xs text-blue-500/80">Наличие</div>
                  <div className="mt-1 font-semibold text-blue-950">
                    {task.selectedOffer.inStock === true ? 'В наличии' : task.selectedOffer.inStock === false ? 'Под заказ' : '—'}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Номер счёта *">
                <input
                  autoFocus
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Например: 125/26"
                  className="input"
                />
              </Field>
              <Field label="Дата счёта *">
                <input
                  type="datetime-local"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="input"
                />
              </Field>
            </div>

            <Field label="Примечание к заказу">
              <textarea
                rows={3}
                value={purchaseOrderNotes}
                onChange={(e) => setPurchaseOrderNotes(e.target.value)}
                placeholder="Условия оплаты, договорённости с поставщиком, важные детали..."
                className="input resize-none"
              />
            </Field>

            <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              После оформления условия выбранного предложения будут зафиксированы в заказе. Следующим этапом станет передача счёта на оплату.
            </div>

            <ModalActions busy={busy} onCancel={() => setOrderFormOpen(false)} submitLabel="Оформить заказ" />
          </form>
        </Modal>
      )}

      {legacyMode && shipModalOpen && (
        <Modal title="Подтвердить отгрузку" onClose={() => setShipModalOpen(false)}>
          <form onSubmit={submitShipment} className="space-y-5">
            <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
              Зафиксируйте фактическую отгрузку и данные, по которым можно контролировать доставку.
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Дата отгрузки *">
                <input
                  type="datetime-local"
                  value={shippedAt}
                  onChange={(e) => setShippedAt(e.target.value)}
                  className="input"
                />
              </Field>

              <Field label="Ожидаемое прибытие">
                <input
                  type="datetime-local"
                  value={expectedDeliveryAt}
                  onChange={(e) => setExpectedDeliveryAt(e.target.value)}
                  className="input"
                />
              </Field>
            </div>

            <Field label="Транспортная компания *">
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="ПЭК, Деловые Линии, СДЭК..."
                className="input"
              />
            </Field>

            <Field label="Трек / ТТН">
              <input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Номер отправления или товарно-транспортной накладной"
                className="input"
              />
            </Field>

            {carrier.trim() && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">После подтверждения</div>
                <div className="mt-2 text-sm font-medium text-slate-800">
                  Отслеживать доставку {carrier.trim()}
                  {trackingNumber.trim() ? `, трек / ТТН ${trackingNumber.trim()}` : ''}
                </div>
              </div>
            )}

            <ModalActions busy={busy} onCancel={() => setShipModalOpen(false)} submitLabel="Подтвердить отгрузку" />
          </form>
        </Modal>
      )}

      {legacyMode && handOverModalOpen && <Modal title="Передать товар" onClose={() => setHandOverModalOpen(false)}><form onSubmit={submitHandOver} className="space-y-4"><Field label="Кому передан товар *"><input autoFocus value={handedOverTo} onChange={(e) => setHandedOverTo(e.target.value)} placeholder="Механик Иванов И.И., склад №2..." className="input" /></Field><p className="text-sm text-slate-500">Дата и время передачи будут зафиксированы автоматически.</p><ModalActions busy={busy} onCancel={() => setHandOverModalOpen(false)} submitLabel="Подтвердить передачу" /></form></Modal>}

      {legacyMode && cancelModalOpen && <Modal title="Отменить заказ" onClose={() => setCancelModalOpen(false)}><form onSubmit={cancelOrder} className="space-y-4"><div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">Заказ останется в истории, а закупка вернётся к выбору поставщика.</div><Field label="Причина отмены *"><textarea autoFocus rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="input resize-none" /></Field><ModalActions busy={busy} onCancel={() => setCancelModalOpen(false)} submitLabel="Отменить заказ" danger /></form></Modal>}

      <style jsx global>{`
        .input { width: 100%; border-radius: 0.75rem; border: 1px solid rgb(226 232 240); padding: 0.75rem 0.875rem; font-size: 0.875rem; outline: none; background: white; }
        .input:focus { border-color: rgb(96 165 250); box-shadow: 0 0 0 3px rgb(219 234 254 / 0.65); }
      `}</style>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3.5"><div className="text-xs text-slate-400">{label}</div><div className="mt-1.5 break-words text-sm font-semibold text-slate-800">{value}</div></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>{children}</label>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 backdrop-blur-[2px] sm:items-center sm:p-4"><div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6"><div className="mb-5 flex items-start justify-between gap-4"><h2 className="text-xl font-semibold">{title}</h2><button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100">×</button></div>{children}</div></div>;
}
function ModalActions({ busy, onCancel, submitLabel, danger = false }: { busy: boolean; onCancel: () => void; submitLabel: string; danger?: boolean }) {
  return <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-50">Отмена</button><button type="submit" disabled={busy} className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{busy ? 'Сохраняем...' : submitLabel}</button></div>;
}
