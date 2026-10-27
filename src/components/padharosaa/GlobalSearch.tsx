'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { apiGet } from '@/components/staff/hooks';
import type { SearchHit } from '@/lib/padharosaa/frontoffice';

const KIND: Record<SearchHit['kind'], string> = { stay: 'Guest', booking: 'Booking', invoice: 'Invoice' };

/** One search box for the front office: a guest's name, room number, mobile number, booking number (B12) or invoice number. */
export function GlobalSearch({ to }: { to: (a: string) => string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      apiGet<{ results: SearchHit[] }>(`/api/padharosaa/v1/staff/frontoffice/search?q=${encodeURIComponent(term)}`).then((r) => { if (alive) setHits(r.results); }, () => { if (alive) setHits([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  const href = (h: SearchHit) => (h.kind === 'stay' ? `${to('billing')}?stay=${h.id}` : h.kind === 'booking' ? `${to('rooms')}?booking=${h.id}` : `${to('billing')}?stay=${h.id}`);
  return (
    <div ref={box} className="relative min-w-0 flex-1 sm:max-w-sm" role="search">
      <input type="search" value={q} aria-label="Search guests, rooms, bookings, invoices" placeholder="Search guest, room, mobile, booking…" autoComplete="off" maxLength={40}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        className="min-h-11 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 text-sm text-stone-900" />
      {open && hits && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-lg" data-testid="search-results">
          {hits.length === 0 && <li className="px-3 py-3 text-sm text-stone-600">Nothing found.</li>}
          {hits.map((h) => (
            <li key={`${h.kind}:${h.id}`}>
              <Link href={href(h)} prefetch={false} onClick={() => { setOpen(false); setQ(''); }} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-1.5 hover:bg-stone-100">
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{h.title}</span>{h.sub && <span className="block truncate text-xs text-stone-500">{h.sub}</span>}</span>
                <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">{KIND[h.kind]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
