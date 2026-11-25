'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Modal } from '@/app/components/Modal';
import { Alert, Badge, Button, Card, Field, Input, Textarea } from '@/app/components/ui';
import type { SupplierOffer } from './ProcurementWorkspace';

type Draft = { selected: boolean; quantity: string };
type Action = (path: string, init: RequestInit, success: string, onFailure: (message: string) => void) => Promise<boolean>;

const quantity = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const steps = ['Позиции', 'Счёт и условия', 'Проверка'];
const milli = (amount: string | number) => Math.round(Number(amount) * 1000);

function cents(value: string | number) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

function priceLabel(amount: bigint) {
  return rubles.formatToParts(amount / BigInt(100)).map((part) => part.type === 'fraction'
    ? (amount % BigInt(100)).toString().padStart(2, '0') : part.value).join('');
}

export default function OrderWizard({ initialOffer, offer, available, unavailable, close, complete, onAction }: {
  initialOffer: SupplierOffer; offer: SupplierOffer | undefined; available: (id: string) => number;
  unavailable: boolean; close: () => void; complete: () => void; onAction: Action;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState('');
  const [invoice, setInvoice] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState<Record<string, Draft>>(() => Object.fromEntries(initialOffer.items.map((item) => {
    const amount = Math.min(Number(item.quantity), available(item.taskItemId));
    return [item.id, { selected: amount > 0, quantity: amount > 0 ? String(amount) : '' }];
  })));
  const lock = useRef(false);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lines = offer?.items ?? [];
  const selected = lines.filter((item) => draft[item.id]?.selected);
  const byId = new Map(lines.map((item) => [item.id, item]));
  const errors = new Map(selected.flatMap((item) => {
    const value = draft[item.id].quantity.trim().replace(',', '.');
    const max = Math.min(milli(item.quantity), milli(available(item.taskItemId)));
    const valid = /^\d+(?:\.\d{1,3})?$/.test(value) && milli(value) > 0 && milli(value) <= max;
    return valid ? [] : [[item.id, `Введите количество от 0,001 до ${quantity.format(max / 1000)}.`] as const];
  }));
  const removed = Object.entries(draft).some(([id, row]) => row.selected && !byId.has(id));
  const invalidRows = Boolean(errors.size) || selected.length === 0 || removed;
  const unsupportedCurrency = selected.some((item) => item.currency !== 'RUB');
  const invoiceError = invoice.trim() ? undefined : 'Введите номер счёта.';
  const dateError = invoiceDate && Number.isFinite(new Date(invoiceDate).getTime()) ? undefined : 'Укажите дату счёта.';
  const allPriced = !invalidRows && selected.every((item) => item.currency === 'RUB' && item.unitPrice !== null);
  const goods = allPriced ? (selected.reduce((total, item) => total + cents(item.unitPrice!)
    * BigInt(milli(draft[item.id].quantity.replace(',', '.'))), BigInt(0)) + BigInt(500)) / BigInt(1000) : null;
  const shipping = offer?.deliveryPrice == null ? null : cents(offer.deliveryPrice);
  const fingerprint = JSON.stringify([offer?.deliveryPrice, offer?.deliveryDays, selected.map((item) =>
    [item.id, item.unitPrice, item.currency, item.quantity, item.inStock])]);

  function navigate(next: number) {
    setStep(next); setChecked(false); heading.current?.focus();
  }

  function update(id: string, patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, [id]: { ...(current[id] ?? { selected: false, quantity: '' }), ...patch } }));
  }

  function cancel() {
    if (busy) return;
    if ((invoice || invoiceDate || notes || step > 0) && !window.confirm('Закрыть форму и удалить черновик заказа?')) return;
    close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || unavailable || !offer) return;
    setError('');
    if (invalidRows) {
      navigate(0); setChecked(true);
      if (removed) {
        setDraft((current) => Object.fromEntries(Object.entries(current).filter(([id]) => byId.has(id))));
        setError('Некоторые позиции исключены из КП. Проверьте оставшиеся строки.');
      } else if (!selected.length) setError('Выберите хотя бы одну позицию.');
      return;
    }
    if (unsupportedCurrency) { navigate(0); setError('Оформление заказа доступно для позиций с ценами в рублях.'); return; }
    if (step === 0) { navigate(1); return; }
    if (invoiceError || dateError) { navigate(1); setChecked(true); return; }
    if (step === 1) { setReviewed(fingerprint); navigate(2); return; }
    if (reviewed !== fingerprint) {
      setReviewed(fingerprint);
      setError('Предложение изменилось. Проверьте обновлённые условия и подтвердите заказ.');
      return;
    }

    lock.current = true;
    setBusy(true);
    try {
      const payload = {
        invoiceNumber: invoice.trim(),
        invoiceDate: new Date(invoiceDate).toISOString(),
        notes: notes.trim() || undefined,
        items: selected.map(item => ({
          supplierOfferItemId: item.id,
          quantity: Number(draft[item.id].quantity.replace(',', '.')),
        })),
      };
      const fingerprint = JSON.stringify(payload);
      if (submission.current?.fingerprint !== fingerprint) {
        submission.current = { fingerprint, key: crypto.randomUUID() };
      }
      const ok = await onAction(`/supplier-offers/${offer.id}/purchase-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: submission.current.key }),
      }, `Заказ у «${offer.supplier.name}» оформлен`, setError);
      if (ok) complete();
    } finally { lock.current = false; setBusy(false); }
  }

  return <Modal busy={busy} title={`Оформить заказ · ${initialOffer.supplier.name}`} onClose={cancel}>
    <form onSubmit={submit} noValidate className="space-y-4 [overflow-wrap:anywhere]">
      <ol className="flex flex-wrap gap-2" aria-label="Этапы заказа">{steps.map((label, index) =>
        <li key={label} aria-current={step === index ? 'step' : undefined}><Badge tone={step === index ? 'info' : 'neutral'}>{index + 1}. {label}</Badge></li>)}</ol>
      <h3 ref={heading} tabIndex={-1} className="font-semibold">{steps[step]}</h3>
      {unavailable && <Alert tone="warning">Предложение больше недоступно для заказа. Проверьте раздел «Заказы».</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <fieldset disabled={busy || unavailable} className="min-w-0 space-y-3">
        {step === 0 && lines.map((item) => {
          const row = draft[item.id];
          const remaining = available(item.taskItemId);
          const id = `order-quantity-${item.id}`;
          const invalid = checked ? errors.get(item.id) : undefined;
          return <Card key={item.id} className="space-y-2 p-3">
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" className="ui-choice"
              checked={row?.selected ?? false} disabled={remaining <= 0 && !row?.selected}
              onChange={(event) => update(item.id, { selected: event.target.checked })} />{item.taskItem.name}</label>
            <p className="text-sm text-muted">Предложено {quantity.format(Number(item.quantity))} · Осталось {quantity.format(remaining)} {item.taskItem.unit}
              {item.inStock === false ? ' · Под заказ' : ''}</p>
            {row?.selected && <Field id={id} label="Количество к заказу" error={invalid}>
              <Input id={id} inputMode="decimal" required value={row.quantity} aria-invalid={Boolean(invalid)}
                aria-describedby={invalid ? `${id}-error` : undefined}
                onChange={(event) => update(item.id, { quantity: event.target.value })} />
            </Field>}
          </Card>;
        })}
        {step === 1 && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="order-invoice" label="Номер счёта" error={checked ? invoiceError : undefined}>
              <Input id="order-invoice" required maxLength={100} value={invoice} aria-invalid={checked && Boolean(invoiceError)}
                aria-describedby={checked && invoiceError ? 'order-invoice-error' : undefined} onChange={(event) => setInvoice(event.target.value)} />
            </Field>
            <Field id="order-invoice-date" label="Дата счёта (местное время)" error={checked ? dateError : undefined}>
              <Input id="order-invoice-date" type="datetime-local" required value={invoiceDate} aria-invalid={checked && Boolean(dateError)}
                aria-describedby={checked && dateError ? 'order-invoice-date-error' : undefined} onChange={(event) => setInvoiceDate(event.target.value)} />
            </Field>
          </div>
          <Field id="order-notes" label="Условия и примечание"><Textarea id="order-notes" rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          <p className="text-sm text-muted">Срок по КП · {offer?.deliveryDays == null ? 'Не указан' : `${offer.deliveryDays} дн.`}</p>
        </>}
        {step === 2 && <Card className="space-y-3 p-4">
          <p><strong>Счёт №{invoice.trim()}</strong> · {new Date(invoiceDate).toLocaleString('ru-RU')}</p>
          <ul className="space-y-1 text-sm">{selected.map((item) => <li key={item.id}>
            {item.taskItem.name} · {draft[item.id].quantity} {item.taskItem.unit} · {item.unitPrice ?? 'Цена не указана'} {item.unitPrice !== null && item.currency}
          </li>)}</ul>
          <div className="border-t border-border pt-3 text-sm">
            <p>Товары · {goods === null ? 'Не рассчитано' : priceLabel(goods)}</p>
            <p>Доставка · {shipping === null ? 'Не указано' : priceLabel(shipping)}</p>
            <p className="font-semibold">Итого по заказу · {goods === null ? 'Не рассчитано' : priceLabel(goods + (shipping ?? BigInt(0)))}</p>
          </div>
          {notes.trim() && <p className="whitespace-pre-wrap text-sm">{notes.trim()}</p>}
          <p className="text-sm text-muted">Подтвердите заказ, чтобы зарезервировать выбранные количества в закупке.</p>
        </Card>}
      </fieldset>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button variant="outline" disabled={busy} onClick={() => step > 0 ? navigate(step - 1) : cancel()}>{step > 0 ? 'Назад' : 'Отмена'}</Button>
        <Button className="ml-auto" type="submit" loading={busy} disabled={unavailable}>{step === 2 ? 'Подтвердить заказ' : 'Продолжить'}</Button>
      </div>
    </form>
  </Modal>;
}
