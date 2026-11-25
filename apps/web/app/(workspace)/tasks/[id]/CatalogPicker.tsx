'use client';

import { useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/api-client';

export type CatalogChoice = {
  id: string;
  name: string;
  partNumber: string | null;
  unit: string;
  category: string;
  attributes: Record<string, string>;
};

export default function CatalogPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (item: CatalogChoice) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/catalog?q=${encodeURIComponent(query.trim())}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Не удалось выполнить поиск по каталогу');
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Некорректные данные каталога');
      setResults(data as CatalogChoice[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка поиска');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
      <div className="text-xs font-semibold text-slate-700">Номенклатура — поиск и привязка</div>
      <form onSubmit={(event) => void search(event)} className="mt-2 flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Название или артикул"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? 'Поиск...' : 'Найти'}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
      {selectedId && <p className="mt-2 text-xs font-semibold text-emerald-700">Карточка выбрана</p>}
      {results.length > 0 && (
        <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
          {results.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry)}
              className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left text-xs transition hover:border-blue-400"
            >
              <span className="font-semibold text-slate-900">{entry.name}</span>
              <span className="ml-2 text-slate-500">{entry.partNumber ?? 'без артикула'} · {entry.unit}</span>
              <span className="mt-1 block text-slate-400">{entry.category} · {Object.keys(entry.attributes ?? {}).length} характеристик</span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] leading-5 text-slate-500">
        Привязка допускается только при совпадении артикула, единицы и технических характеристик.
        Аналог не может подменить исходную спецификацию автоматически.
      </p>
    </div>
  );
}
