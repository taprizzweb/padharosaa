'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ns } from '@/components/ui/ns';

interface Room { id: string; number: string; active: boolean }

/** At check-in: pick the room, make its 4-digit stay code, tell the guest. A new code stops the old one. Only needed when the hotel asks guests for a code. */
export function StayCodeTool({ flash }: { flash: (ok: boolean, text: string) => void }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [room, setRoom] = useState('');
  const [made, setMade] = useState<{ room: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void apiGet<{ rooms: Room[] }>('/api/padharosaa/v1/staff/rooms').then((r) => setRooms(r.rooms.filter((x) => x.active))).catch(() => setRooms([]));
  }, []);
  const make = async () => {
    if (!room) return;
    setBusy(true); setMade(null);
    try { setMade(await apiPost<{ room: string; code: string }>(`/api/padharosaa/v1/staff/rooms/${room}/stay-code`, {})); }
    catch { flash(false, 'The code could not be made. Please try again.'); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-sm font-semibold">Room
          <select className={`${ns.input} !mt-1 w-40`} value={room} onChange={(e) => { setRoom(e.target.value); setMade(null); }}>
            <option value="">Choose…</option>
            {(rooms ?? []).map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
          </select>
        </label>
        <button type="button" className={ns.primary} disabled={!room || busy} onClick={() => void make()}>{busy ? 'Making…' : 'Make a new code'}</button>
      </div>
      {made && (
        <div role="status" data-testid="stay-code" className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-center">
          <p className={ns.label}>Room {made.room}</p>
          <p className="mt-1 text-5xl font-semibold tracking-[.3em]">{made.code}</p>
          <p className="mt-2 text-sm text-stone-600">Tell the guest. It is shown only now. The room&apos;s earlier code no longer works.</p>
        </div>
      )}
    </div>
  );
}
