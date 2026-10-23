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

export interface LinkState { link: string | null; can_create: boolean; rotated_at: string }

/** The guest link and its QR code, shown at any time. A NEW link (which kills every printed QR) needs the person's own password again. */
export function GuestLinkPanel({ slug, load, create, flash, bare }: {
  slug: string; load: () => Promise<LinkState>; create: (password: string) => Promise<{ link: string }>; flash: Flash; bare?: boolean;
}) {
  const [st, setSt] = useState<LinkState | null>(null);
  const [failed, setFailed] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [pw, setPw] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  const show = useCallback(async (s: LinkState) => {
    setSt(s);
    if (!s.link) return setQr(null);
    const QR = (await import('qrcode')).default;
    setQr(await QR.toDataURL(s.link, { margin: 2, width: 640, errorCorrectionLevel: 'M' }));
  }, []);
  const refresh = useCallback(async () => { try { await show(await load()); setFailed(false); } catch { setFailed(true); } }, [load, show]);
  useEffect(() => { void refresh(); }, [refresh]);

  const make = async () => {
    setBusy(true);
    try {
      const r = await create(pw);
      setPw(''); setSure(false); setMaking(false);
      await show({ link: r.link, can_create: true, rotated_at: new Date().toISOString() });
      flash(true, 'New guest link created. Old QR codes no longer work. Print the new one.');
    } catch { flash(false, 'That password was not right, or the link could not be created. Please try again.'); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(st?.link ?? ''); flash(true, 'Link copied.'); } catch { flash(false, 'Copy did not work. Press and hold the link to copy it.'); } };

  const body = (
    <>
      {failed && <p role="alert" className="text-sm font-semibold text-red-900">The guest link could not be loaded. <button type="button" className="underline" onClick={() => void refresh()}>Try again</button></p>}
      {st && st.link && (
        <div className="space-y-3">
          <input readOnly value={st.link} aria-label="Guest link" className={inputCls + ' text-xs'} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnCls} onClick={() => void copy()}>Copy link</button>
            <a className={softCls} href={`https://wa.me/?text=${encodeURIComponent(st.link)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
            <a className={softCls} href={st.link} target="_blank" rel="noopener noreferrer">Open as guest</a>
          </div>
          {qr && (
            <div className="rounded-xl border-2 border-stone-200 p-3 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated in the browser, never leaves the page */}
              <img src={qr} alt="Guest QR code" width={256} height={256} className="mx-auto h-64 w-64" />
              <a className={softCls + ' mt-2'} href={qr} download={`padharosaa-${slug}-qr.png`}>Download QR image</a>
            </div>
          )}
          <p className="text-xs text-stone-600">Link created {new Date(st.rotated_at).toLocaleDateString()}. Print this QR for the rooms. It stays the same until a new link is created.</p>
        </div>
      )}
      {st && !st.link && <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">No saved link yet. {st.can_create ? 'Create it once with your password, then it is always visible here.' : 'Ask the owner to create it.'}</p>}
      {st && st.can_create && !making && <button type="button" className={st.link ? softCls : btnCls} onClick={() => setMaking(true)}>{st.link ? 'Create a new link…' : 'Create guest link'}</button>}
      {st && !st.can_create && st.link && <p className="text-xs text-stone-600">Only the owner can create a new link.</p>}
      {st && st.can_create && making && (
        <form className="space-y-3 rounded-xl border-2 border-red-200 bg-red-50 p-3" onSubmit={(e) => { e.preventDefault(); if ((!st.link || sure) && pw && !busy) void make(); }}>
          <p className="text-sm font-bold text-red-950">{st.link ? 'A new link makes every printed QR code stop working. You will have to print and replace them in every room.' : 'This creates the guest link.'}</p>
          <label className="block text-sm font-semibold">Your password to confirm
            <input type="password" autoComplete="current-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          {st.link && <label className="flex items-start gap-3 text-sm font-semibold"><input type="checkbox" className="mt-1 h-5 w-5" checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand: old QR codes will stop working.</label>}
          <div className="flex gap-2">
            <button type="submit" className={btnCls} disabled={busy || !pw || (!!st.link && !sure)}>{busy ? 'Creating…' : 'Create new link'}</button>
            <button type="button" className={softCls} onClick={() => { setMaking(false); setPw(''); setSure(false); }}>Cancel</button>
          </div>
        </form>
      )}
      {!st && !failed && <p role="status">…</p>}
    </>
  );
  return bare ? <div className="space-y-3">{body}</div> : <Card title="Guest link and QR code" hint="Guests open this link (or scan the QR in their room), enter their name, mobile and room number, and they are in. You can see it here at any time.">{body}</Card>;
}
