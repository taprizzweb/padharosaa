'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Notice, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { parseRooms } from '@/lib/rooms';
import { dashPost, errText, inputCls } from './api';

export interface RoomService { enabled: boolean; url: string | null; qr: string | null; rooms: string[] }

/** One shared link for room service: the guest enters a room number, the order arrives as "Room 204". Owner edits; managers can view. */
export function RoomServiceCard({ rs, canEdit }: { rs: RoomService; canEdit: boolean }) {
  const router = useRouter();
  const [rooms, setRooms] = useState(rs.rooms.join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = async (body: { enabled: boolean; rotate?: boolean }, ok: string) => {
    setErr(null); setMsg(null);
    const parsed = parseRooms(rooms);
    if (!parsed.ok) { setErr(parsed.error); return; }
    setBusy(true);
    try { await dashPost('room-service-save', { rooms, ...body }); setMsg(ok); router.refresh(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(rs.url ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setErr('Could not copy. Select the link and copy it by hand.'); }
  };

  return (
    <section aria-labelledby="room-h" className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="room-h" className="mr-auto text-lg font-extrabold">Room service link</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${rs.enabled ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-900'}`}>{rs.enabled ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-stone-800">For hotels and guest houses: share one link or QR (room card, website, WhatsApp). The guest enters their room number first, then orders. The order appears live on the staff screen as &quot;Room 204&quot;.</p>
      <div className="mt-3 space-y-2" aria-live="polite">
        {err && <Alert>{err}</Alert>}
        {msg && <Notice>{msg}</Notice>}
      </div>

      {rs.enabled && rs.url && rs.qr && (
        <div className="mt-3 flex flex-wrap gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={rs.qr} alt="QR code for the room service link" width={128} height={128} className="h-32 w-32 rounded-lg border border-stone-200" />
          <div className="min-w-0 flex-1">
            <label className="block text-sm font-semibold">Link
              <input readOnly value={rs.url} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} text-sm`} />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={btnSecondary} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
              <a href="/dash/print?layout=room" target="_blank" rel="noopener" className={btnSecondary}>Print room card (A4)</a>
            </div>
          </div>
        </div>
      )}

      {canEdit ? (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save({ enabled: true }, rs.enabled ? 'Room list saved.' : 'Room service is on. Share the link or print the card.'); }}>
          <label className="block text-sm font-semibold">Rooms (optional)
            <textarea value={rooms} onChange={(e) => setRooms(e.target.value)} rows={2} maxLength={4000} placeholder="101-110, 201-210, SUITE 1" className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base font-normal" />
          </label>
          <p className="text-sm text-stone-800">List the real rooms so guests cannot enter a wrong number (ranges like 101-110 work). Leave empty to accept any room number.</p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>{rs.enabled ? 'Save rooms' : 'Turn on room service'}</button>
            {rs.enabled && <button type="button" disabled={busy} className={btnSecondary} onClick={() => void save({ enabled: false }, 'Room service is off. The old link stopped working.')}>Turn off</button>}
            {rs.enabled && <button type="button" disabled={busy} className={btnSecondary} onClick={() => { if (window.confirm('The current link and QR will stop working. You will need to share the new one. Continue?')) void save({ enabled: true, rotate: true }, 'New link created. The old one no longer works.'); }}>New link</button>}
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-stone-800">Only the owner can change room service.</p>
      )}
    </section>
  );
}
