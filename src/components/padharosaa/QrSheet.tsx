'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/components/staff/hooks';
import { roomLink } from '@/lib/padharosaa/qrsheet';

interface Room { id: string; number: string; active: boolean }

/** Printable QR codes: one for the whole hotel (the guest types the room) or one for every room (the room is already filled in). */
export function QrSheet({ hotel }: { hotel: string }) {
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [mode, setMode] = useState<'hotel' | 'rooms'>('rooms');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [perPage, setPerPage] = useState<6 | 12>(6);
  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    void apiGet<{ link: string | null }>('/api/padharosaa/v1/staff/qr').then((r) => setLink(r.link)).catch(() => setLink(null));
    void apiGet<{ rooms: Room[] }>('/api/padharosaa/v1/staff/rooms').then((r) => setRooms(r.rooms.filter((x) => x.active))).catch(() => setRooms([]));
  }, []);
  const chosen = useMemo(() => (mode === 'hotel' ? [] : rooms.filter((r) => !picked || picked.has(r.number))), [mode, rooms, picked]);
  const items = useMemo(() => (!link ? [] : mode === 'hotel' ? [{ key: 'hotel', label: null as string | null, url: link }] : chosen.map((r) => ({ key: r.number, label: r.number, url: roomLink(link, r.number) }))), [link, mode, chosen]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const QR = (await import('qrcode')).default;
      const out: Record<string, string> = {};
      for (const it of items) out[it.key] = await QR.toDataURL(it.url, { margin: 1, width: 480, errorCorrectionLevel: 'M' });
      if (alive) setImages(out);
    })();
    return () => { alive = false; };
  }, [items]);
  const toggle = (n: string) => setPicked((p) => { const s = new Set(p ?? rooms.map((r) => r.number)); if (s.has(n)) s.delete(n); else s.add(n); return s; });

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-3 text-stone-900 print:max-w-none print:p-0">
      <div className="print:hidden" data-testid="qr-controls">
        <h2 className="text-2xl font-semibold tracking-tight">QR codes to print</h2>
        <p className="mt-1 text-sm text-stone-600">Every code opens the same guest page of your hotel. A room code also fills in the room number, so the guest only types a name and a mobile number. The codes never change unless you make a new guest link.</p>
        {link === null && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">The guest link is not made yet. Make it in the console first (Start → Guest link and QR code).</p>}
        <div className="mt-4 flex flex-wrap gap-4">
          <fieldset className="flex gap-2" aria-label="What to print">
            {([['rooms', 'A code for each room'], ['hotel', 'One code for the hotel']] as const).map(([k, l]) => (
              <label key={k} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${mode === k ? 'border-indigo-900 bg-indigo-50' : 'border-stone-300'}`}><input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} />{l}</label>
            ))}
          </fieldset>
          {mode === 'rooms' && (
            <label className="text-sm font-semibold">On each page
              <select className="ml-2 min-h-11 rounded-lg border border-stone-300 px-2" value={perPage} onChange={(e) => setPerPage(Number(e.target.value) as 6 | 12)}><option value={6}>6 large codes</option><option value={12}>12 small codes</option></select>
            </label>
          )}
          <button type="button" className="min-h-11 rounded-lg bg-indigo-900 px-5 text-sm font-semibold text-white disabled:opacity-50" disabled={!link || items.length === 0} onClick={() => window.print()}>Print {items.length} code{items.length === 1 ? '' : 's'}</button>
        </div>
        {mode === 'rooms' && rooms.length > 0 && (
          <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Choose rooms ({chosen.length} of {rooms.length})</summary>
            <div className="flex flex-wrap gap-2 pb-2">
              <button type="button" className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm font-semibold" onClick={() => setPicked(new Set(rooms.map((r) => r.number)))}>All</button>
              <button type="button" className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm font-semibold" onClick={() => setPicked(new Set())}>None</button>
              {rooms.map((r) => <label key={r.id} className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold ${!picked || picked.has(r.number) ? 'border-indigo-900 bg-indigo-50' : 'border-stone-300'}`}><input type="checkbox" checked={!picked || picked.has(r.number)} onChange={() => toggle(r.number)} />{r.number}</label>)}
            </div>
          </details>
        )}
      </div>
      <div className={`mt-6 grid gap-4 print:mt-0 print:gap-3 ${mode === 'hotel' ? 'grid-cols-1 justify-items-center' : perPage === 6 ? 'grid-cols-2' : 'grid-cols-3'}`} data-testid="qr-grid">
        {items.map((it) => (
          <section key={it.key} className="break-inside-avoid rounded-2xl border-2 border-stone-300 p-4 text-center print:rounded-none print:border-stone-400" data-testid="qr-card">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">{hotel}</p>
            <p className={`mt-1 font-semibold ${it.label ? 'text-xl' : 'text-2xl'}`}>{it.label ? `Room ${it.label}` : 'Scan for room service, requests and help'}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated in the browser, never leaves the page */}
            {images[it.key] ? <img src={images[it.key]} alt={it.label ? `QR code for room ${it.label}` : 'QR code for the hotel'} className={`mx-auto mt-2 ${mode === 'hotel' ? 'h-72 w-72' : perPage === 6 ? 'h-44 w-44' : 'h-32 w-32'}`} /> : <div className="mx-auto mt-2 h-32 w-32" />}
            <p className="mt-2 text-xs text-stone-600">{it.label ? 'Scan with your phone camera for room service, housekeeping and help.' : 'Scan with your phone camera, then type your room number.'}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
