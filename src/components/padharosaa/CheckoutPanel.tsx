'use client';

import { dialNumber } from '@/lib/padharosaa/phone';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { formatPaise } from '@/lib/money';

interface Room { id: string; number: string; active: boolean; guests: number; guest_name?: string | null; mobile?: string | null; open_requests?: number; open_orders?: number; unpaid_paise?: number }

/** "Room 102 has checked out": sign the guest out of the hotel app at once. Reception, manager and owner all have it. */
export function CheckoutPanel({ flash }: { flash: (ok: boolean, text: string) => void }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // reception, manager and owner get the live view (open requests and the amount not settled); anyone else gets the plain list
  const load = useCallback(async () => {
    try { setRooms((await apiGet<{ rooms: Room[] }>('/api/padharosaa/v1/staff/live-rooms')).rooms.map((r) => ({ ...r, active: true }))); }
    catch { try { setRooms((await apiGet<{ rooms: Room[] }>('/api/padharosaa/v1/staff/rooms')).rooms); } catch { setRooms([]); } }
  }, []);
  useEffect(() => { void load(); const i = setInterval(() => { if (!document.hidden) void load(); }, 30_000); return () => clearInterval(i); }, [load]);
  const staying = useMemo(() => (rooms ?? []).filter((r) => r.guests > 0 && r.number.toLowerCase().includes(q.trim().toLowerCase())), [rooms, q]);
  const out = async (r: Room) => {
    const open = [r.open_requests ? `${r.open_requests} open request${r.open_requests === 1 ? '' : 's'}` : '', r.open_orders ? `${r.open_orders} food order${r.open_orders === 1 ? '' : 's'} not served` : '', r.unpaid_paise ? `${formatPaise(r.unpaid_paise)} not settled (excluding GST and charges)` : ''].filter(Boolean);
    if (!window.confirm(`Check out Room ${r.number}? ${open.length ? `Still open: ${open.join(', ')}. ` : ''}${r.guests === 1 ? 'The guest is' : `${r.guests} guests are`} signed out of the hotel app now and cannot send requests or orders from their phone any more.`)) return;
    setBusy(r.id);
    try { await apiPost(`/api/padharosaa/v1/staff/rooms/${r.id}/checkout`, {}); flash(true, `Room ${r.number} checked out. The guest is signed out.`); await load(); }
    catch { flash(false, 'The check-out did not go through. Please try again.'); }
    setBusy(null);
  };
  return (
    <details className="mt-3 rounded-2xl bg-white p-3 shadow-sm">
      <summary className="min-h-11 cursor-pointer py-2 text-base font-extrabold">Check out a room · live rooms {rooms && <span className="text-sm font-semibold text-stone-700">({rooms.filter((r) => r.guests > 0).length} with guests)</span>}</summary>
      <p className="text-sm text-stone-700">When a guest leaves, tap their room. They are signed out of the hotel app straight away, so no one can send requests or orders from that room afterwards.</p>
      <label className="mt-2 block text-sm font-semibold">Room number<input value={q} onChange={(e) => setQ(e.target.value)} inputMode="text" autoComplete="off" maxLength={10} className="mt-1 min-h-11 w-full rounded-xl border-2 border-stone-300 bg-white px-3 text-base text-stone-900" /></label>
      {rooms && staying.length === 0 && <p className="mt-2 text-sm text-stone-700">{q.trim() ? 'No room with a guest matches that number.' : 'No room has a guest signed in right now.'}</p>}
      <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="live-rooms">
        {staying.slice(0, 60).map((r) => (
          <li key={r.id} className="rounded-xl border-2 border-stone-200 p-2">
            {r.guest_name && <p className="text-sm font-semibold">Room {r.number} · {r.guest_name}{r.guests > 1 ? ` +${r.guests - 1}` : ''}{r.mobile && <> · <a href={`tel:${dialNumber(r.mobile)}`} className="underline">{r.mobile}</a></>}</p>}
            {(r.open_requests || r.open_orders || r.unpaid_paise) ? (
              <p className="mb-1 flex flex-wrap gap-1 text-xs font-bold">
                {!!r.open_requests && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-950">{r.open_requests} open request{r.open_requests === 1 ? '' : 's'}</span>}
                {!!r.open_orders && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-950">{r.open_orders} food order{r.open_orders === 1 ? '' : 's'}</span>}
                {!!r.unpaid_paise && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-950">{formatPaise(r.unpaid_paise)} not settled · excl. GST and charges</span>}
              </p>
            ) : null}
            <button type="button" disabled={busy === r.id} onClick={() => void out(r)} aria-label={`Check out Room ${r.number}`} className="min-h-11 rounded-full border-2 border-stone-800 px-4 text-sm font-bold text-stone-900 disabled:opacity-50">Check out{r.guest_name ? '' : ` Room ${r.number}`}</button></li>
        ))}
      </ul>
    </details>
  );
}
