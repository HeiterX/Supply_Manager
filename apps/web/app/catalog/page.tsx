'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import AppShell from '../components/AppShell';
import AuthGate from '../components/AuthGate';
import { apiFetch } from '../../lib/api-client';

type CatalogItem = {
  id: string;
  name: string;
  partNumber: string | null;
  category: string;
  unit: string;
  attributes: Record<string, string>;
  createdAt: string;
};

function describeError(value: unknown): string {
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
  }
  return 'Не удалось выполнить операцию';
}

function parseAttributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of value.split('\n')) {
    if (!line.trim()) continue;
    const divider = line.indexOf(':');
    if (divider < 1) throw new Error('Характеристики указываются как «параметр: значение»');
    const key = line.slice(0, divider).trim();
    const specification = line.slice(divider + 1).trim();
    if (!key || !specification || Object.hasOwn(result, key)) {
      throw new Error('Проверьте названия и значения характеристик');
    }
    Object.defineProperty(result, key, {
      value: specification, enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

function CatalogContent() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('шт.');
  const [attributes, setAttributes] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await apiFetch(`/catalog?q=${encodeURIComponent(query.trim())}`, {
        cache: 'no-store', signal,
      });
      if (!response.ok) throw new Error(describeError(await response.json().catch(() => null)));
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Ошибка формата ответа');
      if (!signal?.aborted) {
        setItems(data as CatalogItem[]);
        setError('');
      }
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Ошибка поиска');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    let parsed: Record<string, string>;
    try {
      parsed = parseAttributes(attributes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Некорректные характеристики');
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch('/catalog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), partNumber: partNumber.trim() || undefined,
          category: category.trim() || undefined, unit: unit.trim(), attributes: parsed,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(describeError(data));
      setNotice('Карточка добавлена. Теперь её можно выбрать в закупке.');
      setShowForm(false);
      setName('');
      setPartNumber('');
      setCategory('');
      setUnit('шт.');
      setAttributes('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить карточку');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Единая номенклатура"
      subtitle="Технически согласованные карточки для повторного использования"
      action={
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          {showForm ? 'Закрыть форму' : 'Новая карточка'}
        </button>
      }
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="text-sm font-medium text-slate-700" htmlFor="catalog-search">
          Поиск по наименованию, артикулу или категории
        </label>
        <input
          id="catalog-search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setLoading(true); }}
          placeholder="Например: 6205-2RS, насос, кабель"
          className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-blue-400"
        />
      </section>

      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}

      {showForm && (
        <form onSubmit={(event) => void create(event)} className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Создать номенклатурную карточку</h2>
          <p className="text-sm text-slate-500">
            Одинаковые артикул, единица и набор характеристик не могут быть добавлены дважды.
            Разные варианты характеристик создаются отдельными карточками.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Наименование *
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={500} required
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" />
            </label>
            <label className="text-sm font-medium">
              Артикул
              <input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} maxLength={200}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" />
            </label>
            <label className="text-sm font-medium">
              Категория
              <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={120}
                placeholder="Подшипники, арматура..." className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" />
            </label>
            <label className="text-sm font-medium">
              Единица *
              <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={50} required
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3" />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Характеристики, по одной на строку
            <textarea value={attributes} onChange={(e) => setAttributes(e.target.value)} rows={4}
              placeholder={'Материал: сталь\nДиаметр: 25 мм'}
              className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm" />
          </label>
          <p className="text-xs text-amber-700">
            Справочник не разрешает заменять позиции аналогами без технического согласования.
          </p>
          <button disabled={busy} type="submit"
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Сохраняем...' : 'Создать карточку'}
          </button>
        </form>
      )}

      <section className="mt-5">
        {loading ? (
          <p className="rounded-2xl bg-white p-6 text-sm text-slate-500">Загружаем каталог...</p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500">
            Карточек пока нет. Измените поисковый запрос или создайте первую.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {items.map((item) => (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-950">{item.name}</h3>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{item.category}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Артикул: {item.partNumber ?? 'не указан'} · Ед.: {item.unit}
                </p>
                {Object.keys(item.attributes ?? {}).length > 0 && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-slate-50 p-3 text-xs">
                    {Object.entries(item.attributes).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-slate-500">{key}</dt>
                        <dd className="mt-0.5 font-semibold text-slate-800">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-3 text-xs text-slate-400">ID: {item.id}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

export default function CatalogPage() {
  return <AuthGate><CatalogContent /></AuthGate>;
}
