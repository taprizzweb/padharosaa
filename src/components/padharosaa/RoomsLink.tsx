'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { parseRooms } from '@/lib/padharosaa/rooms';

interface Room { id: string; number: string; active: boolean; guests: number }
type Flash = (ok: boolean, text: string) => void;

const inputCls = 'mt-1 min-h-11 w-full rounded-xl border-2 border-stone-300 bg-white px-3 text-base text-stone-900';
const btnCls = 'min-h-11 rounded-xl bg-stone-900 px-5 text-sm font-bold text-white disabled:opacity-50';
const softCls = 'inline-flex min-h-11 items-center rounded-xl border-2 border-stone-800 px-4 text-sm font-bold disabled:opacity-50';

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm"><h2 className="text-lg font-extrabold">{title}</h2>{hint && <p className="text-sm text-stone-700">{hint}</p>}<div className="mt-3 space-y-3">{children}</div></section>;
}

/** Step 1 of going live: tell Padharosaa which rooms exist. Type "101-110, 201-210" and tap Add. */
export function RoomsCard({ flash }: { flash: Flash }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRooms((await apiGet<{ rooms: Room[] }>('/api/padharosaa/v1/staff/rooms')).rooms); } catch { setRooms([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const p = parseRooms(text);
    if (p.error) return flash(false, p.error);
    setBusy(true);
    try {
      const r = await apiPost<{ added: number }>('/api/padharosaa/v1/staff/rooms', { numbers: p.rooms });
      flash(true, r.added > 0 ? `${r.added} room${r.added === 1 ? '' : 's'} added.` : 'Those rooms were already there.');
      setText('');
      await load();
    } catch { flash(false, 'The rooms could not be added. Use numbers like 101, 102 or 101-110.'); }
    setBusy(false);
  };
  const toggle = async (r: Room) => {
    if (r.active && !window.confirm(`Switch off room ${r.number}?${r.guests ? ` ${r.guests} guest session(s) will end.` : ''}`)) return;
    try { await apiPost(`/api/padharosaa/v1/staff/rooms/${r.id}/active`, { active: !r.active }); await load(); } catch { flash(false, 'That could not be changed.'); }
  };

  return (
    <Card title="Rooms" hint="Guests can only sign in with a room number that is on this list. Type numbers or ranges, for example 101-110, 201-210, 301.">
      <label className="block text-sm font-semibold">Add rooms
        <input className={inputCls} value={text} inputMode="text" autoCapitalize="characters" placeholder="101-110, 201-210" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
      </label>
      <button type="button" className={btnCls} disabled={busy || !text.trim()} onClick={() => void add()}>{busy ? 'Adding…' : 'Add rooms'}</button>
      {rooms === null ? <p role="status">…</p> : rooms.length === 0 ? <p className="text-sm font-semibold text-amber-900">No rooms yet. Add your rooms first, then create the guest link below.</p> : (
        <ul className="flex flex-wrap gap-2" aria-label="Rooms">
          {rooms.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => void toggle(r)} aria-pressed={r.active} title={r.active ? 'Tap to switch off' : 'Switched off. Tap to switch on'}
                className={`min-h-11 rounded-full px-4 text-sm font-bold ${r.active ? 'bg-stone-900 text-white' : 'border-2 border-dashed border-stone-400 text-stone-600 line-through'}`}>
                {r.number}{r.guests > 0 && <span className="ml-1 text-xs font-semibold opacity-80">· {r.guests} in</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Step 2: one tap makes the guest link and its QR code. The key is only ever shown here, right after it is made. */
export function GuestLinkCard({ origin, slug, flash }: { origin: string; slug: string; flash: Flash }) {
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    if (!window.confirm('Create a new guest link? The old link and any printed QR codes will stop working.')) return;
    setBusy(true);
    try {
      const r = await apiPost<{ qr_key: string }>('/api/padharosaa/v1/staff/qr/rotate', { confirm: 'ROTATE' });
      const url = `${origin.replace(/\/$/, '')}/padharosaa/${slug}?k=${r.qr_key}`;
      setLink(url);
      const QR = (await import('qrcode')).default;
      setQr(await QR.toDataURL(url, { margin: 2, width: 640, errorCorrectionLevel: 'M' }));
    } catch { flash(false, 'The guest link could not be created. Please try again.'); }
    setBusy(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link ?? ''); flash(true, 'Link copied.'); } catch { flash(false, 'Copy did not work. Press and hold the link to copy it.'); }
  };

  return (
    <Card title="Guest link and QR code" hint="Guests open this link (or scan the QR in their room), enter their name, mobile and room number, and they are in. The link is shown only right after you create it, so copy or print it then.">
      <button type="button" className={btnCls} disabled={busy} onClick={() => void make()}>{busy ? 'Creating…' : link ? 'Create a new link' : 'Create guest link'}</button>
      {link && (
        <div className="space-y-3">
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-950">Your guest link is ready. Copy or print it now. It cannot be shown again, but you can always create a new one.</p>
          <input readOnly value={link} aria-label="Guest link" className={inputCls + ' text-xs'} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnCls} onClick={() => void copy()}>Copy link</button>
            <a className={softCls} href={`https://wa.me/?text=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
            <a className={softCls} href={link} target="_blank" rel="noopener noreferrer">Open as guest</a>
          </div>
          {qr && (
            <div className="rounded-xl border-2 border-stone-200 p-3 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated in the browser, never leaves the page */}
              <img src={qr} alt="Guest QR code" width={256} height={256} className="mx-auto h-64 w-64" />
              <a className={softCls + ' mt-2'} href={qr} download={`padharosaa-${slug}-qr.png`}>Download QR image</a>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
