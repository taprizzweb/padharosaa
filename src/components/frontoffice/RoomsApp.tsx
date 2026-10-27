'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { Stat } from '@/components/ui/ns';
import { errText } from '@/components/billing/common';
import { occupancy, type Chart } from '@/lib/padharosaa/frontoffice';
import { Housekeeping } from './Housekeeping';
import { Reservations, type Draft } from './Reservations';
import { RatesApp } from '@/components/rates/RatesApp';
import { RoomBoard } from './RoomBoard';
import { RoomChart } from './RoomChart';

const API = '/api/padharosaa/v1/staff/frontoffice';
type Tab = 'status' | 'chart' | 'bookings' | 'housekeeping' | 'prices';

/** Rooms: the chart of every room by day, advance bookings, and the cleaning status of each room. */
export function RoomsApp({ role }: { role: string }) {
  const [tab, setTab] = useState<Tab>('status');
  const [chart, setChart] = useState<Chart | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const flash = useCallback((ok: boolean, text: string) => { setMsg({ ok, text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const load = useCallback(async () => {
    try { setChart(await apiGet<Chart>(`${API}/chart?days=14${start ? `&from=${start}` : ''}`)); } catch (e) { flash(false, errText(e, 'The rooms could not be loaded.')); }
  }, [start, flash]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = new URLSearchParams(location.search).get('tab'); if (t === 'prices' || t === 'housekeeping' || t === 'bookings' || t === 'chart') setTab(t); }, []);
  useEffect(() => { const id = new URLSearchParams(location.search).get('booking'); if (id && /^[0-9a-f-]{36}$/i.test(id)) { setDraft({ edit: id }); setTab('bookings'); } }, []);
  useEffect(() => { const i = setInterval(() => { if (!document.hidden) void load(); }, 30_000); return () => clearInterval(i); }, [load]);

  const [pad, setPad] = useState(false);
  useEffect(() => { setPad(/^padharosaa\./i.test(location.host)); }, []);
  const to = (a: string) => (pad ? `/${a}` : `/padharosaa/${a}`);
  const mark = async (room: { id: string }, status: 'clean' | 'cleaning') => {
    try { await apiPost(`${API}/housekeeping`, { room: room.id, status, note: null }); await load(); } catch (e) { flash(false, errText(e, 'The room could not be updated.')); }
  };
  // rooms with a guest request waiting: they blink red on the status board and open the desk on that room
  const [waiting, setWaiting] = useState<Record<string, { n: number; urgent: boolean }>>({});
  useEffect(() => {
    const OPEN = ['received', 'accepted', 'preparing', 'ready'];
    const look = async () => {
      try {
        const b = await apiGet<{ requests: { room: string; status: string; urgent: boolean }[] }>('/api/padharosaa/v1/staff/board');
        const m: Record<string, { n: number; urgent: boolean }> = {};
        for (const q of b.requests) if (OPEN.includes(q.status)) { const c = m[q.room] ?? { n: 0, urgent: false }; m[q.room] = { n: c.n + 1, urgent: c.urgent || q.urgent }; }
        setWaiting(m);
      } catch { /* the board still works without the blink */ }
    };
    void look();
    const i = setInterval(() => { if (!document.hidden) void look(); }, 5000);
    return () => clearInterval(i);
  }, []);
  const book = (d: Draft) => { setDraft(d); setTab('bookings'); };
  const s = chart?.summary;
  const tabs: [Tab, string][] = [['status', 'Room status'], ['chart', 'Calendar'], ['bookings', 'Bookings'], ['housekeeping', `Housekeeping${s && s.dirty ? ` (${s.dirty} dirty)` : ''}`], ['prices', 'Prices']];
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-3 text-stone-900">
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mb-3 rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{msg.text}</p>}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="rooms-summary">
          <Stat label="Occupancy" value={`${occupancy(s)}%`} sub={`${s.in_house} of ${s.rooms} rooms`} />
          <Stat label="In the hotel" value={s.in_house} />
          <Stat label="Arriving today" value={s.arrivals} />
          <Stat label="Leaving today" value={s.departures} />
          <Stat label="To clean" value={s.dirty} tone={s.dirty ? 'warn' : 'plain'} />
          <Stat label="Out of order" value={s.out_of_order} />
        </div>
      )}
      <div role="tablist" aria-label="Room sections" className="-mx-4 mt-4 flex gap-6 overflow-x-auto border-b border-stone-200 px-4">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px min-h-11 shrink-0 border-b-2 px-0.5 text-sm font-semibold ${tab === k ? 'border-indigo-900 text-indigo-900' : 'border-transparent text-stone-500'}`}>{label}</button>
        ))}
      </div>
      {!chart ? <p className="mt-6" role="status">…</p> : (
        <>
          {tab === 'status' && <RoomBoard chart={chart} to={to} waiting={waiting} canQr={role === 'owner' || role === 'manager'} onMark={(room, status) => void mark(room, status)} />}
          {tab === 'chart' && <RoomChart chart={chart} onShift={(n) => setStart(addShift(chart.from, n))} onToday={() => setStart(null)} onBook={book} />}
          {tab === 'bookings' && <Reservations chart={chart} role={role} draft={draft} clearDraft={() => setDraft(null)} flash={flash} onChanged={() => void load()} />}
          {tab === 'prices' && <RatesApp role={role} />}
          {tab === 'housekeeping' && <Housekeeping chart={chart} flash={flash} onChanged={() => void load()} />}
        </>
      )}
    </div>
  );
}

function addShift(from: string, n: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
