'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ns } from '@/components/ui/ns';
import { dateLabel } from '@/lib/padharosaa/billing';
import { HK_LABEL, bookingNo, type Chart, type ChartBar, type ChartRoom } from '@/lib/padharosaa/frontoffice';

type Filter = 'all' | 'occupied' | 'vacant' | 'dirty' | 'out_of_order';
const FILTER_LABEL: Record<Filter, string> = { all: 'All', occupied: 'Occupied', vacant: 'Vacant', dirty: 'Dirty', out_of_order: 'Out of order' };
const TONE = { occupied: 'border-indigo-300 bg-indigo-50', vacant: 'border-emerald-300 bg-emerald-50', dirty: 'border-red-300 bg-red-50', out_of_order: 'border-stone-300 bg-stone-100', cleaning: 'border-amber-300 bg-amber-50' } as const;

/** Every room on one screen, grouped by type and coloured by state, with today's arrivals and departures beside it. A vacant room is one tap from check-in. */
export function RoomBoard({ chart, to, onMark, waiting = {}, canQr = false }: { chart: Chart; to: (a: string) => string; onMark: (room: ChartRoom, status: 'clean' | 'cleaning') => void; waiting?: Record<string, { n: number; urgent: boolean }>; canQr?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const stayOf = useMemo(() => new Map(chart.bars.filter((b): b is Extract<ChartBar, { kind: 'stay' }> => b.kind === 'stay').map((b) => [b.room_id, b])), [chart.bars]);
  const stateOf = (r: ChartRoom): keyof typeof TONE => (r.hk_status === 'out_of_order' ? 'out_of_order' : r.occupied ? 'occupied' : r.hk_status === 'dirty' ? 'dirty' : r.hk_status === 'cleaning' ? 'cleaning' : 'vacant');
  const shown = chart.rooms.filter((r) => { const s = stateOf(r); return filter === 'all' || (filter === 'occupied' && s === 'occupied') || (filter === 'vacant' && (s === 'vacant' || s === 'cleaning')) || (filter === 'dirty' && r.hk_status === 'dirty') || (filter === 'out_of_order' && s === 'out_of_order'); });
  const groups = useMemo(() => {
    const m = new Map<string, ChartRoom[]>();
    for (const r of shown) m.set(r.type ?? 'Rooms', [...(m.get(r.type ?? 'Rooms') ?? []), r]);
    return [...m.entries()];
  }, [shown]);
  const arrivals = chart.bars.filter((b): b is Extract<ChartBar, { kind: 'booking' }> => b.kind === 'booking' && b.from <= chart.today && b.to > chart.today);
  const departures = chart.bars.filter((b): b is Extract<ChartBar, { kind: 'stay' }> => b.kind === 'stay' && b.to <= chart.today);
  const n = (f: Filter) => chart.rooms.filter((r) => { const s = stateOf(r); return f === 'all' || (f === 'occupied' && s === 'occupied') || (f === 'vacant' && (s === 'vacant' || s === 'cleaning')) || (f === 'dirty' && r.hk_status === 'dirty') || (f === 'out_of_order' && s === 'out_of_order'); }).length;
  const roomNo = (id: string | null) => chart.rooms.find((r) => r.id === id)?.number;

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section aria-label="Room status" className="min-w-0">
        <div role="group" aria-label="Show rooms" className="flex flex-wrap gap-2">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((k) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${filter === k ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white'}`}>{FILTER_LABEL[k]} {n(k)}</button>)}
        </div>
        {chart.rooms.length === 0 && <p className="mt-4 text-sm text-stone-600">No rooms yet. Rooms are added in the owner console (Hotel).</p>}
        <div className="mt-3 space-y-5" data-testid="room-board">
          {groups.map(([type, rooms]) => (
            <div key={type}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{type} <span className="font-normal">· {rooms.length}</span></h3>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {rooms.map((r) => {
                  const s = stateOf(r);
                  const stay = stayOf.get(r.id);
                  const w = waiting[r.number];
                  return (
                    <div key={r.id} data-testid="board-room" data-waiting={w ? w.n : 0} className={`relative rounded-xl border p-3 ${w ? 'animate-pulse border-red-600 bg-red-100 ring-2 ring-red-500' : TONE[s]}`}>
                      {w && <Link href={`${to('desk')}?room=${encodeURIComponent(r.number)}`} prefetch={false} aria-label={`Room ${r.number}: ${w.n} request${w.n === 1 ? '' : 's'} waiting. Open them`} className="absolute inset-0 z-10 rounded-xl" />}
                      {w && <p className="relative z-20 mb-1 inline-block rounded bg-red-700 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">{w.n} request{w.n === 1 ? '' : 's'}{w.urgent ? ' · URGENT' : ''}</p>}
                      <div className="flex items-baseline justify-between gap-1"><p className="text-xl font-semibold">{r.number}</p><p className="text-[10px] font-semibold uppercase tracking-wide text-stone-600">{s === 'occupied' ? 'Occupied' : s === 'vacant' ? 'Vacant' : HK_LABEL[r.hk_status]}</p></div>
                      {stay ? (
                        <Link href={`${to('billing')}?stay=${stay.id}`} prefetch={false} className="mt-1 block min-h-9 text-sm font-semibold underline-offset-2 hover:underline">{stay.guest}<span className="block text-xs font-normal text-stone-600">until {dateLabel(stay.to)}</span></Link>
                      ) : s === 'out_of_order' ? <p className="mt-1 text-xs text-stone-700">{r.hk_note ?? 'Not in service'}</p>
                        : s === 'dirty' ? <button type="button" className={`${ns.secondary} mt-1 !min-h-9 !px-2 text-xs`} onClick={() => onMark(r, 'clean')}>Mark clean</button>
                        : s === 'cleaning' ? <button type="button" className={`${ns.secondary} mt-1 !min-h-9 !px-2 text-xs`} onClick={() => onMark(r, 'clean')}>Done cleaning</button>
                        : <Link href={`${to('billing')}?checkin=${r.id}`} prefetch={false} className="relative z-20 mt-1 inline-flex min-h-9 items-center rounded-lg bg-emerald-700 px-2.5 text-xs font-semibold text-white">Check in</Link>}
                      {canQr && <Link href={`${to('qr')}?room=${encodeURIComponent(r.number)}`} prefetch={false} className="relative z-20 mt-1 block text-[11px] font-semibold text-stone-600 underline">QR code of this room</Link>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
      <aside className="space-y-3" aria-label="Today">
        <div className={ns.card} data-testid="board-arrivals">
          <h3 className="text-sm font-semibold">Arriving today <span className="font-normal text-stone-500">· {arrivals.length}</span></h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {arrivals.map((b) => <li key={b.id} className="flex justify-between gap-2"><span className="min-w-0 truncate"><b>{b.guest}</b><span className="block text-xs text-stone-500">{bookingNo(b.seq)} · {roomNo(b.room_id) ? `Room ${roomNo(b.room_id)}` : 'room not chosen'}</span></span><Link href={`${to('rooms')}?booking=${b.id}`} prefetch={false} className="shrink-0 self-center text-xs font-semibold underline">Open</Link></li>)}
            {arrivals.length === 0 && <li className="text-stone-600">Nobody.</li>}
          </ul>
        </div>
        <div className={ns.card} data-testid="board-departures">
          <h3 className="text-sm font-semibold">Leaving today <span className="font-normal text-stone-500">· {departures.length}</span></h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {departures.map((b) => <li key={b.id} className="flex justify-between gap-2"><span className="min-w-0 truncate"><b>{b.guest}</b><span className="block text-xs text-stone-500">Room {roomNo(b.room_id)}</span></span><Link href={`${to('billing')}?stay=${b.id}`} prefetch={false} className="shrink-0 self-center text-xs font-semibold underline">Bill</Link></li>)}
            {departures.length === 0 && <li className="text-stone-600">Nobody.</li>}
          </ul>
        </div>
      </aside>
    </div>
  );
}
