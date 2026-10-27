'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiPost } from '@/components/staff/hooks';
import { ns } from '@/components/ui/ns';
import { PAY_MODES, dayFromToday, nightsBetween, rupees2, type BillingSetup, type StayRow } from '@/lib/padharosaa/billing';
import { parseRupeesToPaise } from '@/lib/money';
import { Label, errText, field, type Flash } from './common';

const ID_TYPES = [['aadhaar', 'Aadhaar'], ['passport', 'Passport'], ['driving_licence', 'Driving licence'], ['voter_id', 'Voter ID'], ['other', 'Other']] as const;

const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** A guest arrives: the room, who they are, the rate, the planned last day and the advance. The guest app login is made in the same step. */
export function CheckIn({ presetRoom, setup, inHouse, flash, onDone, onOpen }: { presetRoom?: string | null; setup: BillingSetup; inHouse: StayRow[]; flash: Flash; onDone: () => void; onOpen: (stayId: string) => void }) {
  const taken = useMemo(() => new Set(inHouse.map((s) => s.room)), [inHouse]);
  const free = setup.rooms.filter((r) => r.active && !taken.has(r.number));
  const tomorrow = dayFromToday(1);
  const [f, setF] = useState({ room: '', guest: '', mobile: '', idType: '', idLast4: '', adults: '1', company: '', gstin: '', rate: '', outOn: tomorrow, inTime: nowTime(), advance: '', mode: 'cash' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ stay_id: string; room: string; stay_code: string; guest: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const type = (id: string | null) => setup.room_types.find((t) => t.id === id);
  const pick = (id: string) => {
    const r = setup.rooms.find((x) => x.id === id);
    const t = type(r?.room_type_id ?? null);
    setF((p) => ({ ...p, room: id, rate: t ? String(t.rate_paise / 100) : p.rate }));
  };
  useEffect(() => {
    if (presetRoom && free.some((r) => r.id === presetRoom)) pick(presetRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the link's room or the loaded setup changes, never while the desk is typing
  }, [presetRoom, setup]);
  const ratePaise = f.rate.trim() ? parseRupeesToPaise(f.rate) : null;
  const advPaise = f.advance.trim() ? parseRupeesToPaise(f.advance) : 0;
  const nights = nightsBetween(dayFromToday(0), f.outOn);
  const ok = f.room && f.guest.trim().length >= 2 && f.outOn > dayFromToday(0) && (f.rate.trim() === '' || ratePaise !== null) && advPaise !== null && (f.rate.trim() !== '' || type(setup.rooms.find((r) => r.id === f.room)?.room_type_id ?? null));

  const submit = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ stay_id: string; room: string; stay_code: string }>('/api/padharosaa/v1/staff/stays', {
        room: f.room, guest: f.guest.trim(), mobile: f.mobile.trim() || null, id_type: f.idType || null, id_last4: f.idLast4.trim() || null, adults: Number(f.adults) || 1,
        company: f.company.trim() || null, gstin: f.gstin.trim() || null, rate_paise: ratePaise, out_on: f.outOn, in_time: f.inTime || null, advance_paise: advPaise ?? 0, advance_mode: advPaise ? f.mode : null,
      });
      setDone({ ...r, guest: f.guest.trim() });
      onDone();
    } catch (e) { flash(false, errText(e, 'The guest could not be checked in. Please check the details.')); }
    setBusy(false);
  };

  if (done) {
    return (
      <section className={`mt-4 ${ns.card}`} data-testid="checkin-done">
        <p className={ns.label}>Room {done.room}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{done.guest} is checked in</h2>
        <p className="mt-3 text-sm text-stone-600">Stay code for the guest app (needed only if your hotel asks guests for a code):</p>
        <p className="mt-1 text-4xl font-semibold tracking-[.3em]" data-testid="stay-code">{done.stay_code}</p>
        <p className="mt-1 text-xs text-stone-500">It is shown only now. A new code can be made any time from the desk.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={ns.primary} onClick={() => onOpen(done.stay_id)}>Open the bill</button>
          <button type="button" className={ns.secondary} onClick={() => { setDone(null); setF({ room: '', guest: '', mobile: '', idType: '', idLast4: '', adults: '1', company: '', gstin: '', rate: '', outOn: tomorrow, inTime: nowTime(), advance: '', mode: 'cash' }); }}>Check in another guest</button>
        </div>
      </section>
    );
  }
  return (
    <form className={`mt-4 ${ns.card}`} onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void submit(); }}>
      <h2 className="text-base font-semibold tracking-tight">Check in a guest</h2>
      {free.length === 0 && <p className="mt-2 text-sm font-semibold text-amber-900" role="status">No free room. Rooms are added in the owner console, or a guest must check out first.</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Label text="Room"><select aria-label="Room" className={field} value={f.room} onChange={(e) => pick(e.target.value)}><option value="">Choose a free room…</option>{free.map((r) => <option key={r.id} value={r.id}>{r.number}{type(r.room_type_id) ? ` · ${type(r.room_type_id)!.name}` : ''}</option>)}</select></Label>
        <Label text="Guest name"><input className={field} value={f.guest} maxLength={80} autoComplete="off" onChange={(e) => set('guest', e.target.value)} /></Label>
        <Label text="Mobile number"><input className={field} inputMode="tel" value={f.mobile} maxLength={20} autoComplete="off" onChange={(e) => set('mobile', e.target.value)} /></Label>
        <Label text="Adults"><input className={field} inputMode="numeric" value={f.adults} onChange={(e) => set('adults', e.target.value)} /></Label>
        <Label text="ID shown"><select className={field} value={f.idType} onChange={(e) => set('idType', e.target.value)}><option value="">Not taken</option>{ID_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Label>
        <Label text="Last 4 of the ID number" hint="Only these are kept, never the full number."><input className={field} value={f.idLast4} maxLength={4} autoComplete="off" onChange={(e) => set('idLast4', e.target.value)} /></Label>
        <Label text="Rate per night in ₹" hint={f.room && !f.rate ? 'The room has no rate. Type one.' : undefined}><input className={field} inputMode="decimal" value={f.rate} onChange={(e) => set('rate', e.target.value)} /></Label>
        <Label text="Check-in time" hint="Today. Change it if the guest arrived earlier."><input className={field} type="time" value={f.inTime} onChange={(e) => set('inTime', e.target.value)} /></Label>
        <Label text="Leaving on" hint={`${nights} night${nights === 1 ? '' : 's'}${ratePaise ? ` · ${rupees2(nights * ratePaise)} before tax` : ''}`}><input className={field} type="date" min={tomorrow} value={f.outOn} onChange={(e) => set('outOn', e.target.value)} /></Label>
        <Label text="Company (if the company pays)"><input className={field} value={f.company} maxLength={120} onChange={(e) => set('company', e.target.value)} /></Label>
        <Label text="Company GSTIN" hint="From another state? Then the bill shows IGST automatically."><input className={field} value={f.gstin} maxLength={15} autoCapitalize="characters" onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></Label>
        <Label text="Advance taken in ₹"><input className={field} inputMode="decimal" value={f.advance} onChange={(e) => set('advance', e.target.value)} /></Label>
        <Label text="Advance paid by"><select className={field} value={f.mode} onChange={(e) => set('mode', e.target.value)}>{PAY_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Label>
      </div>
      <button type="submit" className={`${ns.primary} mt-4`} disabled={!ok || busy}>{busy ? 'Checking in…' : 'Check in'}</button>
    </form>
  );
}
