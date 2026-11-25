'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { entityLabels, useCoreResource, type Entity, type Page } from '../../lib/discovery';
import { buttonClass, fieldClass } from './DiscoveryControls';

type Hit = { entity: Entity; id: string; title: string; reference: string | null; href: string };

export default function GlobalSearch() {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const term = query.trim();
  const search = useCoreResource<Page<Hit>>(term && open
    ? `/discovery/search?${new URLSearchParams({ q: term, page: String(page), pageSize: '8' })}`
    : null, 300);
  return (
    <div className="relative w-full sm:max-w-md"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          input.current?.focus();
          setOpen(false);
        }
      }}>
      <label className="sr-only" htmlFor="global-search">Поиск по Supply Manager</label>
      <input ref={input} id="global-search" type="search" autoComplete="off" className={fieldClass} maxLength={120}
        value={query} placeholder="Поиск по Supply Manager" onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setPage(1); setOpen(true); }} />
      {open && term && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-[55vh] overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          {search.loading && <p role="status" className="p-3 text-sm text-slate-500">Поиск…</p>}
          {search.error && (
            <div className="space-y-2 p-3">
              <p role="alert" className="text-sm text-rose-700">{search.error}</p>
              <button type="button" className={buttonClass} onClick={() => void search.reload()}>Повторить</button>
            </div>
          )}
          {search.data && (
            <>
              {search.data.items.length === 0 && <p role="status" className="p-3 text-sm text-slate-500">Совпадений нет.</p>}
              <ul aria-label="Результаты поиска">
                {search.data.items.map((hit) => (
                  <li key={`${hit.entity}:${hit.id}`}>
                    <Link href={hit.href} onClick={() => { setOpen(false); setQuery(''); }}
                      className="block rounded-lg px-3 py-2 hover:bg-blue-50 focus:bg-blue-50">
                      <span className="block text-xs font-medium text-slate-500">{entityLabels[hit.entity]}{hit.reference ? ` · ${hit.reference}` : ''}</span>
                      <span className="block break-words text-sm font-medium text-slate-950">{hit.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {(search.data.hasPrevious || search.data.hasNext) && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 p-2 text-xs text-slate-600">
                  <button type="button" className={buttonClass} disabled={!search.data.hasPrevious} onClick={() => setPage(page - 1)}>Назад</button>
                  <span>Найдено {search.data.total}</span>
                  <button type="button" className={buttonClass} disabled={!search.data.hasNext} onClick={() => setPage(page + 1)}>Далее</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
