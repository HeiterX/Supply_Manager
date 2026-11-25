import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api-client';
import type { PurchaseOrder } from './ProcurementWorkspace';

type StockBalance = { received: string; returned: string; accepted: string; handedOver: string };
type Invoice = {
  id: string; number: string; issuedOn: string; dueOn: string | null; amount: string; currency: string;
  comment: string | null; approvalStatus: string; paymentStatus: string; overdue: boolean;
  paid: string; remaining: string; lastPaymentOn: string | null;
  payments: { id: string; amount: string; paidOn: string; reference: string; cancelledAt: string | null }[];
};
type Line = StockBalance & {
  id: string; name: string; unit: string; quantity: string; remaining: string;
  openDiscrepancies: { id: string; reason: string; quantity: string; comment: string | null }[];
};
type Shipment = {
  id: string; number: string; status: string; expectedOn: string | null; shippedOn: string | null;
  arrivedOn: string | null; carrier: string | null; trackingNumber: string | null;
  items: (StockBalance & { id: string; quantity: string; purchaseOrderItemId: string })[];
};
type Ledger = {
  id: string; cancelledAt: string | null; ledgerEnabled: boolean; canEnableLedger: boolean;
  legacyInvoiceNumber: string | null;
  finance: { billed: string; paid: string; unsettled: string | null } | null;
  invoices: Invoice[]; shipments: Shipment[]; items: Line[];
};
type LedgerView = {
  locked: boolean; canRecordFinance: boolean; blockers: string[]; orders: Ledger[];
  positions: (StockBalance & { id: string; name: string; unit: string; requested: string;
    ordered: string; unordered: string; shipped: string; remaining: string })[];
  operations: { id: string; actorId: string; actorName: string | null; action: string; createdAt: string;
    before: unknown; after: unknown }[];
};

const labels = {
  'enable-ledger': 'Подключить учёт', 'create-invoice': 'Добавить счёт', 'edit-invoice': 'Изменить счёт',
  'approve-invoice': 'Согласовать счёт', 'cancel-invoice': 'Отменить счёт', 'register-payment': 'Записать платёж',
  'cancel-payment': 'Скорректировать платёж', 'create-shipment': 'Создать партию',
  'dispatch-shipment': 'Отметить отгрузку', 'arrive-shipment': 'Отметить прибытие',
  'cancel-shipment': 'Отменить партию', 'short-close-shipment': 'Закрыть партию с недопоставкой',
  receive: 'Принять', return: 'Зарегистрировать возврат', handover: 'Передать получателю',
  'report-discrepancy': 'Зафиксировать расхождение', 'resolve-discrepancy': 'Урегулировать расхождение',
} as const;
type Action = keyof typeof labels;
type Selection = { action: Action; order: Ledger; targetId?: string; invoice?: Invoice };
type SubmitAction = (path: string, init: RequestInit, success: string, onFailure?: (message: string) => void) => Promise<boolean>;

const states: Record<string, string> = {
  DRAFT: 'На согласовании', APPROVED: 'Согласован', CANCELLED: 'Отменён',
  UNPAID: 'Не оплачен', PARTIALLY_PAID: 'Оплачен частично', PAID: 'Оплачен',
  WAITING_DISPATCH: 'Ожидает отгрузки', IN_TRANSIT: 'В пути', ARRIVED: 'Прибыла',
  PARTIALLY_RECEIVED: 'Принята частично', RECEIVED: 'Принята', SHORT_CLOSED: 'Закрыта с недопоставкой',
};
const reasons: Record<string, string> = {
  SHORTAGE: 'Недопоставка', DAMAGED: 'Повреждение', WRONG_ITEM: 'Несоответствие номенклатуры',
  INCOMPLETE: 'Ошибочная комплектация', OTHER: 'Другое',
};
const risky = new Set<Action>([
  'enable-ledger', 'approve-invoice', 'cancel-invoice', 'register-payment', 'cancel-payment',
  'cancel-shipment', 'short-close-shipment', 'return', 'handover', 'resolve-discrepancy',
]);
const day = (value: string | null) => value ? value.slice(0, 10) : '—';
const btn = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const card = 'space-y-3 rounded-xl border border-slate-200 bg-white p-4';

function Field({ name, label, type = 'text', value, pattern, required = true }: {
  name: string; label: string; type?: string; value?: string; pattern?: string; required?: boolean;
}) {
  return <label className="block space-y-1 text-sm">
    <span>{label}</span>
    <input className={input} name={name} type={type} defaultValue={value} pattern={pattern}
      inputMode={pattern ? 'decimal' : undefined} maxLength={120} required={required} />
  </label>;
}

function OperationForm({ selection, busy, onAction, dismiss, refresh }: {
  selection: Selection; busy: boolean; onAction: SubmitAction; dismiss: () => void; refresh: () => void;
}) {
  const { action, invoice, order, targetId } = selection;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.focus();
  }, []);
  const invoiceForm = action === 'create-invoice' || action === 'edit-invoice';
  const paymentForm = action === 'register-payment';
  const shipmentForm = action === 'create-shipment';
  const dispatch = action === 'dispatch-shipment';
  const report = action === 'report-discrepancy';
  const quantity = action === 'receive' || action === 'return' || action === 'handover' || report;
  const withDate = invoiceForm || paymentForm || dispatch || quantity || action === 'arrive-shipment' || action === 'resolve-discrepancy';
  const today = new Date().toISOString().slice(0, 10);
  const needsComment = ['cancel-invoice', 'cancel-payment', 'cancel-shipment', 'short-close-shipment', 'return', 'handover', 'resolve-discrepancy'].includes(action);
  const withComment = invoiceForm || paymentForm || shipmentForm || quantity || needsComment;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy) return;
    const fields = new FormData(event.currentTarget);
    const values: Record<string, string> = {};
    const items: { itemId: string; quantity: string }[] = [];
    for (const [name, raw] of fields) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      if (name.startsWith('item-')) items.push({ itemId: name.slice(5), quantity: raw.trim() });
      else values[name] = raw.trim();
    }
    if (shipmentForm && !items.length) {
      setError('Укажите количество хотя бы одной позиции.');
      return;
    }
    const confirmation = action === 'enable-ledger'
      ? 'Подтверждаете сверку и отсутствие прежних оплат, отгрузок и приёмок?'
      : labels[action] + '?';
    if (risky.has(action) && !window.confirm(confirmation)) return;
    const body = { action, targetId, ...values, ...(shipmentForm ? { items } : {}) };
    const payload = JSON.stringify(body);
    if (pending.current?.payload !== payload) pending.current = { payload, key: crypto.randomUUID() };
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const ok = await onAction('/orders/' + order.id + '/fulfillment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, key: pending.current.key }),
      }, 'Операция сохранена', setError);
      if (ok) dismiss();
      refresh();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return <form ref={form} tabIndex={-1} className={card} onSubmit={submit} aria-label={labels[action]}>
    <h4 className="font-semibold">{labels[action]}</h4>
    <div className="grid gap-3 sm:grid-cols-2">
      {(invoiceForm || paymentForm || shipmentForm) && <Field name="number"
        label={invoiceForm ? 'Номер счёта' : paymentForm ? 'Номер подтверждения' : 'Номер партии'}
        value={invoiceForm ? invoice?.number ?? order.legacyInvoiceNumber ?? undefined : undefined} />}
      {(invoiceForm || paymentForm) && <>
        <Field name="amount" label="Сумма" pattern="[0-9]{1,12}([.][0-9]{1,2})?" value={invoiceForm ? invoice?.amount : undefined} />
        <label className="block space-y-1 text-sm"><span>Валюта</span>
          <select className={input} name="currency" defaultValue="RUB"><option value="RUB">RUB</option></select>
        </label>
      </>}
      {withDate && <Field name="date" label={invoiceForm ? 'Дата выставления' : 'Дата события'} type="date"
        value={invoiceForm && invoice ? day(invoice.issuedOn) : today} />}
      {invoiceForm && <Field name="dueOn" label="Срок оплаты" type="date" required={false} value={invoice?.dueOn?.slice(0, 10)} />}
      {(shipmentForm || dispatch) && <Field name="expectedOn" label="Ожидаемая дата прибытия" type="date" required={false} />}
      {dispatch && <>
        <Field name="carrier" label="Перевозчик" />
        <Field name="trackingNumber" label="Трек-номер" required={false} />
      </>}
      {shipmentForm && order.items.map(line => <Field key={line.id} name={'item-' + line.id}
        label={line.name + ' (' + line.unit + ')'} pattern="[0-9]{1,11}([.][0-9]{1,3})?" required={false} />)}
      {quantity && <Field name="quantity" label="Количество" pattern="[0-9]{1,11}([.][0-9]{1,3})?" />}
      {report && <label className="block space-y-1 text-sm"><span>Вид расхождения</span>
        <select required name="reason" className={input}>
          {Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>}
      {withComment && <label className="block space-y-1 text-sm sm:col-span-2">
        <span>{action === 'handover' ? 'Получатель' : needsComment ? 'Основание операции' : 'Комментарий'}</span>
        <textarea className={input} name="comment" required={needsComment} maxLength={1500} defaultValue={invoiceForm ? invoice?.comment ?? '' : ''} />
      </label>}
    </div>
    {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button className={btn} disabled={busy || saving}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
      <button className={btn} type="button" onClick={dismiss} disabled={saving}>Отмена</button>
    </div>
  </form>;
}

export default function FulfillmentPanel({ taskId, orders, taskStatus, busy, onAction }: {
  taskId: string; orders: PurchaseOrder[]; taskStatus: string; busy: boolean; onAction: SubmitAction;
}) {
  const [request, setRequest] = useState(0);
  const [load, setLoad] = useState<{ version: string; data?: LedgerView; error?: string }>();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [closeError, setCloseError] = useState('');
  const version = JSON.stringify([taskStatus, request, ...orders.map(order => [order.id, order.version])]);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchLedger() {
      try {
        const response = await apiFetch(`/tasks/${taskId}/fulfillment`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Не удалось загрузить состояние закупки (' + response.status + ').');
        const data = await response.json() as LedgerView;
        if (!controller.signal.aborted) setLoad({ version, data });
      } catch (error) {
        if (!controller.signal.aborted) setLoad({ version, error: error instanceof Error ? error.message : 'Не удалось загрузить состояние закупки.' });
      }
    }
    void fetchLedger();
    return () => controller.abort();
  }, [taskId, version]);

  const refresh = () => setRequest(value => value + 1);
  const data = load?.data;
  const loaded = version === load?.version;
  if (loaded && load?.error && !data) return <div role="alert" className={card}>
    <p>{load.error}</p><button className={btn} onClick={refresh}>Повторить загрузку</button>
  </div>;
  if (!data) return <p role="status">Загрузка счетов и поставок…</p>;

  return <section aria-label="Счета, поставки и приёмка" aria-busy={!loaded} className="space-y-4">
    <div className={card}>
      <h3 className="font-semibold">Исполнение по позициям</h3>
      {data.positions.length ? <div className="grid gap-3 lg:grid-cols-2">
        {data.positions.map(line => <div key={line.id} className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium">{line.name} · {line.unit}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries({
              'Запрошено': line.requested, 'Заказано': line.ordered, 'Не заказано': line.unordered, 'Отгружено': line.shipped,
              'Получено': line.received, 'Возвращено': line.returned, 'Принято': line.accepted,
              'Передано': line.handedOver, 'Осталось выполнить': line.remaining,
            }).map(([label, value]) => <div key={label} className="flex justify-between gap-1"><dt>{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}
          </dl>
        </div>)}
      </div> : <p className="text-sm text-slate-600">Позиции ещё не добавлены.</p>}
    </div>
    {data.orders.map(order => {
      const editable = !data.locked && !order.cancelledAt;
      const action = (key: Action, targetId?: string, invoice?: Invoice) => editable &&
        <button className={btn} disabled={busy || !loaded || !!selection} onClick={() => setSelection({ action: key, order, targetId, invoice })}>{labels[key]}</button>;
      const supplier = orders.find(row => row.id === order.id)?.supplier.name;
      return <article key={order.id} className={card}>
        <h3 className="font-semibold">{supplier ?? order.id}</h3>
        {!order.ledgerEnabled ? <>
          <p className="text-sm">Заказ в прежнем формате. Для переноса начатых операций требуется сверка.</p>
          {order.canEnableLedger && action('enable-ledger')}
        </> : <>
          <section className="space-y-2" aria-label="Счета и оплаты">
            <h4 className="font-medium">Счета и оплаты</h4>
            <p className="text-sm">Выставлено {order.finance?.billed} ₽ · Оплачено {order.finance?.paid} ₽ · Остаток по заказу {order.finance?.unsettled ?? '—'} ₽</p>
            {order.invoices.length === 0 && <p className="text-sm">Счета ещё не зарегистрированы.</p>}
            {!data.canRecordFinance && editable && <p className="text-sm text-slate-600">Согласование и платежи доступны уполномоченной учётной записи.</p>}
            {order.invoices.map(invoice => <div key={invoice.id} className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-medium">Счёт № {invoice.number} от {day(invoice.issuedOn)} · {invoice.amount} {invoice.currency}</p>
              <p>{states[invoice.approvalStatus]} · {states[invoice.paymentStatus]}{invoice.overdue ? ' · Просрочен' : ''} · Срок {day(invoice.dueOn)}</p>
              <p>Оплачено {invoice.paid} · Остаток {invoice.remaining} · Последний платёж {day(invoice.lastPaymentOn)}</p>
              {invoice.comment && <p className="break-words">{invoice.comment}</p>}
              {invoice.payments.map(payment => <div key={payment.id} className="flex flex-wrap items-center gap-2">
                <span>Платёж № {payment.reference} от {day(payment.paidOn)} · {payment.amount} {invoice.currency}{payment.cancelledAt ? ' · Отменён' : ''}</span>
                {data.canRecordFinance && !payment.cancelledAt && action('cancel-payment', payment.id)}
              </div>)}
              <div className="flex flex-wrap gap-2">
                {invoice.approvalStatus === 'DRAFT' && action('edit-invoice', invoice.id, invoice)}
                {invoice.approvalStatus !== 'CANCELLED' && !invoice.payments.length && action('cancel-invoice', invoice.id)}
                {data.canRecordFinance && invoice.approvalStatus === 'DRAFT' && action('approve-invoice', invoice.id)}
                {data.canRecordFinance && invoice.approvalStatus === 'APPROVED' && invoice.paymentStatus !== 'PAID' && action('register-payment', invoice.id)}
              </div>
            </div>)}
            {action('create-invoice')}
          </section>
          <section className="space-y-2" aria-label="Партии и приёмка">
            <h4 className="font-medium">Партии и приёмка</h4>
            {order.shipments.length === 0 && <p className="text-sm">Партии ещё не зарегистрированы.</p>}
            {order.shipments.map(shipment => <div key={shipment.id} className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-medium">Партия № {shipment.number} · {states[shipment.status]}</p>
              <p>Отгрузка {day(shipment.shippedOn)} · Ожидается {day(shipment.expectedOn)} · Прибытие {day(shipment.arrivedOn)}</p>
              {(shipment.carrier || shipment.trackingNumber) && <p className="break-words">Перевозчик {shipment.carrier ?? '—'} · Трек {shipment.trackingNumber ?? '—'}</p>}
              <div className="flex flex-wrap gap-2">
                {shipment.status === 'WAITING_DISPATCH' && <>{action('dispatch-shipment', shipment.id)}{action('cancel-shipment', shipment.id)}</>}
                {shipment.status === 'IN_TRANSIT' && action('arrive-shipment', shipment.id)}
                {['ARRIVED', 'PARTIALLY_RECEIVED'].includes(shipment.status) && action('short-close-shipment', shipment.id)}
              </div>
              {shipment.items.map(line => <div key={line.id} className="space-y-2 border-t border-slate-200 pt-2">
                <p>{order.items.find(row => row.id === line.purchaseOrderItemId)?.name} · В партии {line.quantity} · Получено {line.received} · Возвращено {line.returned} · Принято {line.accepted}</p>
                {shipment.arrivedOn && <div className="flex flex-wrap gap-2">
                  {line.quantity !== line.received && shipment.status !== 'SHORT_CLOSED' && action('receive', line.id)}
                  {line.accepted !== '0' && action('return', line.id)}
                  {action('report-discrepancy', line.id)}
                </div>}
              </div>)}
            </div>)}
            {action('create-shipment')}
            {order.items.map(line => <div key={line.id} className="space-y-2 border-t border-slate-200 pt-2 text-sm">
              <p>{line.name} · Заказано {line.quantity} · Принято {line.accepted} · Осталось получить {line.remaining} · Передано {line.handedOver} {line.unit}</p>
              {line.accepted !== line.handedOver && action('handover', line.id)}
              {line.openDiscrepancies.map(row => <div key={row.id} className="flex flex-wrap items-center gap-2">
                <span>{reasons[row.reason]} · {row.quantity} {line.unit} {row.comment}</span>{action('resolve-discrepancy', row.id)}
              </div>)}
            </div>)}
          </section>
          <p className="text-sm text-slate-600">Защищённая загрузка документов ожидает CORE-15.</p>
        </>}
        {selection?.order.id === order.id && <OperationForm selection={selection} busy={busy} onAction={onAction}
          dismiss={() => setSelection(null)} refresh={refresh} />}
      </article>;
    })}
    {data.operations.length > 0 && <details className={card}>
      <summary className="cursor-pointer font-medium">Последние операции</summary>
      <ul className="space-y-2 text-sm">{data.operations.map(row => <li key={row.id}>
        {labels[row.action as Action] ?? (row.action === 'close' ? 'Закупка закрыта' : row.action)} · {day(row.createdAt)} · {row.actorName ?? row.actorId}
        {row.after != null && <details><summary className="cursor-pointer">Данные операции</summary>
          <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({ before: row.before, after: row.after }, null, 2)}</pre>
        </details>}
      </li>)}</ul>
    </details>}
    {!data.locked && data.orders.some(order => order.ledgerEnabled) && <div className={card}>
      <h3 className="font-semibold">Закрытие закупки</h3>
      {data.blockers.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
        {[...new Set(data.blockers)].map(message => <li key={message}>{message}</li>)}
      </ul>}
      {closeError && <p className="text-sm text-rose-700" role="alert">{closeError}</p>}
      <button className={btn} disabled={busy || !loaded || !!selection || data.blockers.length > 0}
        onClick={async () => {
          if (!window.confirm('Закрыть закупку?')) return;
          setCloseError('');
          await onAction('/orders/close', { method: 'PATCH' }, 'Закупка закрыта', setCloseError);
          refresh();
        }}>Закрыть закупку</button>
    </div>}
  </section>;
}
