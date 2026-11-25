'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import AppShell from '../components/AppShell';
import AuthGate from '../components/AuthGate';
import { apiFetch } from '../../lib/api-client';

type Supplier = {
  id: string; name: string; taxId: string | null; legalAddress: string | null;
  bankDetails: string | null; contact: string | null; phone: string | null;
  email: string | null; website: string | null; categories: string[];
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED'; responsibleId: string | null;
  notes: string | null; _count?: { offers: number; purchaseOrders: number };
};
type Change = { id: string; action: string; before: unknown; after: unknown; createdAt: string };
type SupplierDetail = Supplier & {
  responsible: { id: string; fullName: string } | null;
  history: Change[];
  offers: Array<{ id: string; taskId: string; status: string; version: number; currency: string | null; price: string | null; createdAt: string }>;
  purchaseOrders: Array<{ id: string; taskId: string; status: string; invoiceNumber: string | null; totalPrice: string | null; orderedAt: string }>;
};
type Owner = { id: string; fullName: string; role: string };
type FormFields = {
  name: string; taxId: string; legalAddress: string; bankDetails: string;
  contact: string; phone: string; email: string; website: string;
  categories: string; status: 'ACTIVE' | 'PAUSED' | 'BLOCKED';
  responsibleId: string; notes: string;
};
const emptyForm: FormFields = {
  name: '', taxId: '', legalAddress: '', bankDetails: '',
  contact: '', phone: '', email: '', website: '',
  categories: '', status: 'ACTIVE', responsibleId: '', notes: '',
};
const inputClass = 'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500';
const statusLabels = { ACTIVE: 'Работаем', PAUSED: 'Приостановлен', BLOCKED: 'Заблокирован' } as const;
const formatted = (value: string) => new Date(value).toLocaleString('ru-RU');

function messageFromError(value: unknown): string {
  if (value && typeof value === 'object' && 'message' in value) {
    const m = (value as { message: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.join('; ');
  }
  return 'Не удалось выполнить операцию';
}

function SuppliersContent() {
  const [query, setQuery] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [selected, setSelected] = useState<SupplierDetail | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormFields>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/suppliers?q=${encodeURIComponent(query)}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(async r => {
      if (!r.ok) throw new Error(messageFromError(await r.json().catch(() => null)));
      return r.json() as Promise<Supplier[]>;
    }).then(data => {
      if (!controller.signal.aborted) { setSuppliers(data); setError(''); }
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [query, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch('/suppliers/responsibles', { signal: controller.signal })
      .then(r => r.ok ? r.json() as Promise<Owner[]> : [])
      .then(users => { if (!controller.signal.aborted) setOwners(users); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function showDetails(id: string) {
    setError('');
    try {
      const response = await apiFetch(`/suppliers/${id}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(messageFromError(await response.json().catch(() => null)));
      setSelected(await response.json() as SupplierDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка карточки');
    }
  }

  function edit(item?: SupplierDetail) {
    setEditId(item?.id ?? null);
    setForm(item ? {
      name: item.name, taxId: item.taxId ?? '', legalAddress: item.legalAddress ?? '',
      bankDetails: item.bankDetails ?? '', contact: item.contact ?? '',
      phone: item.phone ?? '', email: item.email ?? '', website: item.website ?? '',
      categories: item.categories.join(', '), status: item.status,
      responsibleId: item.responsibleId ?? '', notes: item.notes ?? '',
    } : emptyForm);
    setShowForm(true);
    setNotice(''); setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      const body = {
        ...form,
        name: form.name.trim(), taxId: form.taxId.trim() || undefined,
        categories: form.categories.split(',').map(s => s.trim()).filter(Boolean),
        responsibleId: form.responsibleId || undefined,
      };
      const response = await apiFetch(editId ? `/suppliers/${editId}` : '/suppliers', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(messageFromError(await response.json().catch(() => null)));
      const result = await response.json() as Supplier;
      setNotice(editId ? 'Карточка поставщика обновлена' : 'Поставщик добавлен в справочник');
      setShowForm(false);
      setLoading(true); setRefresh(v => v + 1);
      await showDetails(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  }

  function field(label: string, key: keyof FormFields, options?: { rows?: number }) {
    const common = { value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })) };
    return <label className="block text-xs font-semibold text-slate-600">
      {label}
      {options?.rows ?
        <textarea rows={options.rows} className={inputClass} value={form[key]}
          onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))} /> :
        <input {...common} className={inputClass} maxLength={key === 'name' ? 300 : 500}
          required={key === 'name'} />}
    </label>;
  }

  return <AppShell title="Справочник поставщиков"
    subtitle="Единые реквизиты, контакты, категории и история КП"
    action={<button type="button" onClick={() => edit()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">＋ Поставщик</button>}>
    <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
      <label htmlFor="supplier-search" className="text-xs font-semibold text-slate-600">Поиск поставщика</label>
      <input id="supplier-search" value={query}
        onChange={e => { setQuery(e.target.value); setLoading(true); }}
        placeholder="Наименование, ИНН, контакт, категория"
        className={inputClass} />
    </div>
    {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(350px,1fr)]">
      <section className="space-y-3">
        {loading && <p className="rounded-xl bg-white p-5 text-sm text-slate-500">Загрузка...</p>}
        {!loading && suppliers.length === 0 && <p className="rounded-xl bg-white p-5 text-sm text-slate-500">Поставщики не найдены.</p>}
        {!loading && suppliers.map(item => (
          <button key={item.id} onClick={() => void showDetails(item.id)} type="button"
            className={`block w-full rounded-2xl border bg-white p-4 text-left transition hover:border-blue-300 ${selected?.id === item.id ? 'border-blue-500 ring-2 ring-blue-50' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-slate-900">{item.name}</span>
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${item.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {statusLabels[item.status]}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-500">ИНН: {item.taxId ?? 'не указан'} · {item.contact ?? 'Контакт не указан'}</div>
            <div className="mt-2 text-xs text-slate-500">КП: {item._count?.offers ?? 0} · Заказов: {item._count?.purchaseOrders ?? 0}</div>
            <div className="mt-2 text-xs text-blue-700">{item.categories.join(', ') || 'Категории не указаны'}</div>
          </button>
        ))}
      </section>
      <section className="space-y-4">
        {showForm && (
          <form onSubmit={e => void save(e)} className="space-y-4 rounded-2xl border border-blue-200 bg-white p-5">
            <div className="flex justify-between gap-3"><h2 className="font-semibold">{editId ? 'Изменить поставщика' : 'Новый поставщик'}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500">Закрыть</button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {field('Наименование *', 'name')}
              {field('ИНН (10 или 12 цифр)', 'taxId')}
              {field('Контактное лицо', 'contact')}
              {field('Телефон', 'phone')}
              {field('Email', 'email')}
              {field('Сайт', 'website')}
            </div>
            {field('Категории через запятую', 'categories')}
            {field('Юридический адрес', 'legalAddress', { rows: 2 })}
            {field('Банковские реквизиты', 'bankDetails', { rows: 2 })}
            {field('Заметки', 'notes', { rows: 2 })}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">Статус
                <select className={inputClass} value={form.status}
                  onChange={e => setForm(prev => ({ ...prev, status: e.target.value as FormFields['status'] }))}>
                  <option value="ACTIVE">Работаем</option>
                  <option value="PAUSED">Приостановлен</option>
                  <option value="BLOCKED">Заблокирован</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Ответственный
                <select className={inputClass} value={form.responsibleId}
                  onChange={e => setForm(prev => ({ ...prev, responsibleId: e.target.value }))}>
                  <option value="">Не назначен</option>
                  {owners.map(o => <option key={o.id} value={o.id}>{o.fullName} · {o.role}</option>)}
                </select>
              </label>
            </div>
            <button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Сохраняем...' : 'Сохранить'}</button>
          </form>
        )}
        {selected && !showForm && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold">{selected.name}</h2>
              <p className="mt-1 text-sm text-slate-500">ИНН {selected.taxId ?? 'не указан'} · {statusLabels[selected.status]}</p></div>
              <button onClick={() => edit(selected)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">Редактировать</button>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Контакт: {selected.contact || 'не указан'} · {selected.phone || 'телефон не указан'}</p>
              <p>Email: {selected.email || 'не указан'}</p>
              <p>Юр. адрес: {selected.legalAddress || 'не указан'}</p>
              <p>Реквизиты: {selected.bankDetails || 'не указаны'}</p>
              <p>Ответственный: {selected.responsible?.fullName ?? 'не назначен'}</p>
              <p>Категории: {selected.categories.join(', ') || 'не указаны'}</p>
            </div>
            <h3 className="mt-6 font-semibold">Коммерческие предложения</h3>
            <div className="mt-2 space-y-2">
              {selected.offers.length === 0 && <p className="text-xs text-slate-500">Пока нет КП</p>}
              {selected.offers.map(o => (
                <Link href={`/tasks/${o.taskId}`} key={o.id} className="block rounded-xl bg-slate-50 p-3 text-xs hover:bg-blue-50">
                  КП · версия {o.version} · {o.status} · {o.currency ?? 'валюта не указана'} · {o.price ?? 'цена не указана'}
                </Link>
              ))}
            </div>
            <h3 className="mt-6 font-semibold">Заказы</h3>
            <div className="mt-2 space-y-2">
              {selected.purchaseOrders.length === 0 && <p className="text-xs text-slate-500">Пока нет заказов</p>}
              {selected.purchaseOrders.map(o => (
                <Link href={`/tasks/${o.taskId}`} key={o.id} className="block rounded-xl bg-slate-50 p-3 text-xs hover:bg-blue-50">
                  Счёт №{o.invoiceNumber ?? 'не указан'} · {o.status} · {formatted(o.orderedAt)}
                </Link>
              ))}
            </div>
            <h3 className="mt-6 font-semibold">История изменений карточки</h3>
            <div className="mt-2 space-y-2">
              {selected.history.length === 0 && <p className="text-xs text-slate-500">Нет записей</p>}
              {selected.history.map(c => (
                <details key={c.id} className="rounded-xl bg-slate-50 p-3 text-xs">
                  <summary className="cursor-pointer font-semibold">{c.action} · {formatted(c.createdAt)}</summary>
                  {c.before !== null && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">До: {JSON.stringify(c.before, null, 2)}</pre>}
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">После: {JSON.stringify(c.after, null, 2)}</pre>
                </details>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  </AppShell>;
}

export default function SuppliersPage() {
  return <AuthGate><SuppliersContent /></AuthGate>;
}
