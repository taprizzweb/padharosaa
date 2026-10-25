'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';

interface Room { id: string; number: string; active: boolean; guests: number }

/** "Room 102 has checked out": sign the guest out of the hotel app at once. Reception, manager and owner all have it. */
export function CheckoutPanel({ flash }: { flash: (ok: boolean, text: string) => void }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { try { setRooms((await apiGet<{ rooms: Room[] }>('/api/padharosaa/v1/staff/rooms')).rooms); } catch { setRooms([]); } }, []);
  useEffect(() => { void load(); const i = setInterval(() => { if (!document.hidden) void load(); }, 30_000); return () => clearInterval(i); }, [load]);
  const staying = useMemo(() => (rooms ?? []).filter((r) => r.guests > 0 && r.number.toLowerCase().includes(q.trim().toLowerCase())), [rooms, q]);
  const out = async (r: Room) => {
    if (!window.confirm(`Check out Room ${r.number}? ${r.guests === 1 ? 'The guest is' : `${r.guests} guests are`} signed out of the hotel app now and cannot send requests or orders from their phone any more.`)) return;
    setBusy(r.id);
    try { await apiPost(`/api/padharosaa/v1/staff/rooms/${r.id}/checkout`, {}); flash(true, `Room ${r.number} checked out. The guest is signed out.`); await load(); }
    catch { flash(false, 'The check-out did not go through. Please try again.'); }
    setBusy(null);
  };
  return (
    <details className="mt-3 rounded-2xl bg-white p-3 shadow-sm">
      <summary className="min-h-11 cursor-pointer py-2 text-base font-extrabold">Check out a room {rooms && <span className="text-sm font-semibold text-stone-700">({rooms.filter((r) => r.guests > 0).length} with guests)</span>}</summary>
      <p className="text-sm text-stone-700">When a guest leaves, tap their room. They are signed out of the hotel app straight away, so no one can send requests or orders from that room afterwards.</p>
      <label className="mt-2 block text-sm font-semibold">Room number<input value={q} onChange={(e) => setQ(e.target.value)} inputMode="text" autoComplete="off" maxLength={10} className="mt-1 min-h-11 w-full rounded-xl border-2 border-stone-300 bg-white px-3 text-base text-stone-900" /></label>
      {rooms && staying.length === 0 && <p className="mt-2 text-sm text-stone-700">{q.trim() ? 'No room with a guest matches that number.' : 'No room has a guest signed in right now.'}</p>}
      <ul className="mt-2 flex flex-wrap gap-2">
        {staying.slice(0, 60).map((r) => (
          <li key={r.id}><button type="button" disabled={busy === r.id} onClick={() => void out(r)} aria-label={`Check out Room ${r.number}`} className="min-h-11 rounded-full border-2 border-stone-800 px-4 text-sm font-bold text-stone-900 disabled:opacity-50">Room {r.number}{r.guests > 1 ? ` · ${r.guests}` : ''}</button></li>
        ))}
      </ul>
    </details>
  );
}
