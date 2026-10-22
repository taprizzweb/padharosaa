'use client';
import { useEffect, useMemo, useState } from 'react';
import { formatPaise } from '@/lib/money';
import { ApiFailure } from '@/lib/guest/client';
import { errorMessageKey, t } from '@/lib/i18n';
import { Alert, DietMark, IconSearch } from '@/components/guest/ui';
import { apiGet, apiPost, handleAuthFailure } from './hooks';

interface Item {
  id: string;
  name: string;
  category: string;
  diet: 'veg' | 'nonveg' | 'egg' | 'jain';
  price_paise: number;
  is_available: boolean;
}

/** Fast sold-out switches for every role: search, then one tap per dish. */
export function SoldOutView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState('');
  const [onlySoldOut, setOnlySoldOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = () =>
    apiGet<{ items: Item[] }>('/api/staff/items')
      .then((r) => setItems(r.items))
      .catch((e) => {
        if (!handleAuthFailure(e)) setError(t(errorMessageKey(e instanceof ApiFailure ? e.key : 'network')));
      });
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (item: Item) => {
    const next = !item.is_available;
    setError(null);
    setPending((p) => new Set(p).add(item.id));
    setItems((cur) => cur && cur.map((i) => (i.id === item.id ? { ...i, is_available: next } : i))); // optimistic
    try {
      await apiPost('/api/staff/availability', { item_ids: [item.id], available: next });
    } catch (e) {
      setItems((cur) => cur && cur.map((i) => (i.id === item.id ? { ...i, is_available: !next } : i)));
      if (!handleAuthFailure(e)) setError(t(errorMessageKey(e instanceof ApiFailure ? e.key : 'network')));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(item.id);
        return n;
      });
    }
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Item[]>();
    for (const i of items ?? []) {
      if (onlySoldOut && i.is_available) continue;
      if (q && !i.name.toLowerCase().includes(q) && !i.category.toLowerCase().includes(q)) continue;
      map.set(i.category, [...(map.get(i.category) ?? []), i]);
    }
    return [...map.entries()];
  }, [items, query, onlySoldOut]);

  if (!items) return <p className="py-16 text-center text-lg text-stone-700">{error ?? 'Loading dishes…'}</p>;
  const soldCount = items.filter((i) => !i.is_available).length;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block min-w-60 flex-1">
          <span className="sr-only">Search dishes</span>
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search dishes" autoComplete="off" className="h-12 w-full rounded-xl border border-stone-300 bg-white pl-10 pr-3 text-base" />
        </label>
        <button type="button" aria-pressed={onlySoldOut} onClick={() => setOnlySoldOut((v) => !v)} className={`inline-flex min-h-12 items-center rounded-xl border-2 px-4 font-bold ${onlySoldOut ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white'}`}>
          Sold out only ({soldCount})
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {groups.length === 0 && <p className="py-10 text-center text-stone-700">No dishes match.</p>}
      {groups.map(([cat, list]) => (
        <section key={cat} aria-label={cat}>
          <h2 className="mb-2 text-lg font-extrabold">{cat}</h2>
          <ul className="grid gap-2 lg:grid-cols-2">
            {list.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={i.is_available}
                  aria-label={`${i.name}: ${i.is_available ? 'available' : 'sold out'}`}
                  disabled={pending.has(i.id)}
                  onClick={() => toggle(i)}
                  className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border-2 px-4 text-left ${i.is_available ? 'border-stone-300 bg-white' : 'border-red-700 bg-red-50'}`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <DietMark diet={i.diet} t={t} />
                    <span className="min-w-0">
                      <span className="block truncate text-lg font-bold">{i.name}</span>
                      <span className="text-sm text-stone-700">{formatPaise(i.price_paise)}</span>
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-extrabold ${i.is_available ? 'bg-emerald-100 text-emerald-950' : 'bg-red-200 text-red-950'}`}>
                    {i.is_available ? 'Available' : 'Sold out'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
