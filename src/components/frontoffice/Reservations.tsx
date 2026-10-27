'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ns } from '@/components/ui/ns';
import { Label, errText, field, small, th, td, type Flash } from '@/components/billing/common';
import { PAY_MODES, dateLabel, nightsBetween, rupees2 } from '@/lib/padharosaa/billing';
import { addDays, bookingNo, usableRoom, type Chart, type Reservation } from '@/lib/padharosaa/frontoffice';
import { ApiFailure } from '@/lib/guest/client';
import { parseRupeesToPaise } from '@/lib/money';

const API = '/api/padharosaa/v1/staff/frontoffice';
export type Draft = { edit?: string; room?: string; from?: string };
type Scope = 'today' | 'upcoming' | 'past';
const ID_TYPES = [['aadhaar', 'Aadhaar'], ['passport', 'Passport'], ['driving_licence', 'Driving licence'], ['voter_id', 'Voter ID'], ['other', 'Other']] as const;
const STATUS_LABEL: Record<string, string> = { booked: 'Booked', checked_in: 'Checked in', cancelled: 'Cancelled', no_show: 'No show' };

/** Advance bookings: arriving today, upcoming, and past ones; a booking form; and check-in from a booking. */
export function Reservations({ chart, draft, clearDraft, flash, onChanged }: { chart: Chart; role: string; draft: Draft | null; clearDraft: () => void; flash: Flash; onChanged: () => void }) {
  const [scope, setScope] = useState<Scope>('today');
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [form, setForm] = useState<Draft | null>(null);
  const [arrive, setArrive] = useState<Reservation | null>(null);
  const load = useCallback(async () => {
    try { setRows((await apiGet<{ reservations: Reservation[] }>(`${API}/reservations?scope=${scope}`)).reservations); } catch (e) { flash(false, errText(e, 'The bookings could not be loaded.')); }
  }, [scope, flash]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (draft) { setForm(draft); clearDraft(); } }, [draft, clearDraft]);

  const changed = () => { void load(); onChanged(); };
  const [editing, setEditing] = useState<Reservation | null>(null);
  useEffect(() => {
    const id = form?.edit;
    if (!id || editing?.id === id) return;
    let alive = true;
    void (async () => {
      try {
        for (const sc of ['upcoming', 'today'] as const) { // a booking can be on either list
          const r = (await apiGet<{ reservations: Reservation[] }>(`${API}/reservations?scope=${sc}`)).reservations.find((x) => x.id === id);
          if (r) { if (alive) setEditing(r); return; }
        }
        if (alive) { flash(false, 'That booking is closed and cannot be edited.'); setForm(null); }
      } catch (e) { if (alive) flash(false, errText(e)); }
    })();
    return () => { alive = false; };
  }, [form, editing, flash]);
  const close = async (r: Reservation, status: 'cancelled' | 'no_show') => {
    const reason = window.prompt(status === 'cancelled' ? `Cancel booking ${bookingNo(r.seq)} of ${r.guest_name}? Reason (optional):` : `Mark ${r.guest_name} as a no-show? Note (optional):`);
    if (reason === null) return;
    try { await apiPost(`${API}/reservation-close`, { id: r.id, status, reason: reason.trim() || null }); flash(true, status === 'cancelled' ? 'Booking cancelled.' : 'Marked as no-show.'); changed(); } catch (e) { flash(false, errText(e)); }
  };

  return (
    <section className="mt-4" aria-label="Bookings">
      {form ? (form.edit && !editing ? <p role="status">…</p> :
        <BookingForm chart={chart} draft={form} existing={editing} flash={flash} onClose={() => { setForm(null); setEditing(null); }} onSaved={() => { setForm(null); setEditing(null); changed(); }} />)
       : arrive ? (
        <ArrivePanel r={arrive} chart={chart} flash={flash} onClose={() => setArrive(null)} onDone={() => { setArrive(null); changed(); }} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Show bookings" className="flex gap-2">
              {([['today', 'Arriving today'], ['upcoming', 'Upcoming'], ['past', 'Past']] as const).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${scope === k ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white'}`}>{l}</button>
              ))}
            </div>
            <button type="button" className={`${ns.primary} ml-auto`} onClick={() => setForm({})}>New booking</button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-stone-200 bg-stone-50"><tr><th className={th}>Booking</th><th className={th}>Guest</th><th className={th}>Stay</th><th className={th}>Room</th><th className={`${th} text-right`}>Advance</th><th className={th} /></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {rows?.map((r) => (
                  <tr key={r.id} data-testid="booking-row">
                    <td className={td}><span className="font-semibold">{bookingNo(r.seq)}</span>{r.source && <span className="block text-xs text-stone-500">{r.source}</span>}</td>
                    <td className={td}>{r.guest_name}{r.mobile && <span className="block text-xs text-stone-500">{r.mobile}</span>}{r.notes && <span className="block text-xs text-stone-500">{r.notes}</span>}</td>
                    <td className={td}>{dateLabel(r.check_in_on)} → {dateLabel(r.check_out_on)}<span className="block text-xs text-stone-500">{r.nights} night{r.nights === 1 ? '' : 's'} · {rupees2(r.rate_paise)}/night</span></td>
                    <td className={td}>{r.room ?? <span className="text-amber-800">{r.room_type ?? 'Not chosen'}</span>}</td>
                    <td className={`${td} text-right`}>{r.advance_paise ? rupees2(r.advance_paise) : '—'}</td>
                    <td className={`${td} text-right`}>
                      {r.status === 'booked' ? (
                        <span className="flex flex-wrap justify-end gap-1.5">
                          {r.check_in_on <= chart.today && <button type="button" className={ns.primary + ' !min-h-9 !px-3'} onClick={() => setArrive(r)}>Check in</button>}
                          <button type="button" className={small} onClick={() => { setEditing(r); setForm({ edit: r.id }); }}>Edit</button>
                          <button type="button" className={small} onClick={() => void close(r, 'cancelled')}>Cancel</button>
                          {r.check_in_on <= chart.today && <button type="button" className={small} onClick={() => void close(r, 'no_show')}>No show</button>}
                        </span>
                      ) : <span className="text-xs font-semibold text-stone-600">{STATUS_LABEL[r.status]}{r.cancel_reason ? ` · ${r.cancel_reason}` : ''}</span>}
                    </td>
                  </tr>
                ))}
                {rows && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-stone-600">{scope === 'today' ? 'Nobody is booked to arrive today.' : scope === 'upcoming' ? 'No upcoming bookings.' : 'Nothing here yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function BookingForm({ chart, draft, existing, flash, onClose, onSaved }: { chart: Chart; draft: Draft; existing: Reservation | null; flash: Flash; onClose: () => void; onSaved: () => void }) {
  const from0 = existing?.check_in_on ?? draft.from ?? chart.today;
  const [f, setF] = useState({
    room: existing?.room_id ?? draft.room ?? '', type: existing?.room_type_id ?? '', guest: existing?.guest_name ?? '', mobile: existing?.mobile ?? '', adults: String(existing?.adults ?? 1),
    from: from0, to: existing?.check_out_on ?? addDays(from0, 1), rate: existing ? String(existing.rate_paise / 100) : '', advance: existing?.advance_paise ? String(existing.advance_paise / 100) : '',
    mode: existing?.advance_mode ?? 'cash', source: existing?.source ?? '', notes: existing?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(!!existing);
  const set = (k: keyof typeof f, v: string) => { if (k === 'rate') setTouched(true); setF((p) => ({ ...p, [k]: v })); };
  const roomRow = chart.rooms.find((r) => r.id === f.room);
  const typeRate = roomRow?.rate_paise ?? null;
  const pickRoom = (id: string) => setF((p) => ({ ...p, room: id }));
  // the price of the chosen room type on the arrival day, from the price calendar (until the desk types its own)
  const typeId = roomRow?.type_id ?? (f.type || null);
  useEffect(() => {
    if (touched || !typeId) return;
    let alive = true;
    apiGet<{ rate_paise: number }>(`${API}/rate-on?type=${typeId}&day=${f.from}`).then((r) => { if (alive) setF((p) => ({ ...p, rate: String(r.rate_paise / 100) })); }, () => undefined);
    return () => { alive = false; };
  }, [typeId, f.from, touched]);
  const ratePaise = f.rate.trim() ? parseRupeesToPaise(f.rate) : typeRate;
  const advPaise = f.advance.trim() ? parseRupeesToPaise(f.advance) : 0;
  const nights = nightsBetween(f.from, f.to);
  const ok = f.guest.trim().length >= 2 && f.to > f.from && f.from >= chart.today && ratePaise !== null && advPaise !== null && (f.room || f.type);
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ seq: number }>(`${API}/reservation`, {
        id: existing?.id ?? null, room: f.room || null, type: f.room ? null : f.type || null, guest: f.guest.trim(), mobile: f.mobile.trim() || null, adults: Number(f.adults) || 1,
        check_in: f.from, check_out: f.to, rate_paise: ratePaise, advance_paise: advPaise ?? 0, advance_mode: advPaise ? f.mode : null, source: f.source.trim() || null, notes: f.notes.trim() || null,
      });
      flash(true, `Booking ${bookingNo(r.seq)} saved.`);
      onSaved();
    } catch (e) { flash(false, e instanceof ApiFailure && e.status === 409 ? 'That room is not free on those dates. Pick another room or other dates.' : errText(e, 'The booking could not be saved. Please check the details.')); }
    setBusy(false);
  };
  return (
    <form className={ns.card} onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void save(); }}>
      <h2 className="text-base font-semibold tracking-tight">{existing ? `Edit booking ${bookingNo(existing.seq)}` : 'New booking'}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Label text="Guest name"><input className={field} value={f.guest} maxLength={80} autoComplete="off" onChange={(e) => set('guest', e.target.value)} /></Label>
        <Label text="Mobile number"><input className={field} inputMode="tel" value={f.mobile} maxLength={20} autoComplete="off" onChange={(e) => set('mobile', e.target.value)} /></Label>
        <Label text="Arriving on"><input className={field} type="date" min={chart.today} value={f.from} onChange={(e) => { set('from', e.target.value); if (f.to <= e.target.value) set('to', addDays(e.target.value, 1)); }} /></Label>
        <Label text="Leaving on" hint={`${nights} night${nights === 1 ? '' : 's'}${ratePaise ? ` · ${rupees2(nights * ratePaise)} before tax` : ''}`}><input className={field} type="date" min={addDays(f.from, 1)} value={f.to} onChange={(e) => set('to', e.target.value)} /></Label>
        <Label text="Room" hint="Choose a room now, or only a type and pick the room at check-in."><select aria-label="Room" className={field} value={f.room} onChange={(e) => pickRoom(e.target.value)}><option value="">Not chosen yet</option>{chart.rooms.filter((r) => usableRoom(r) || r.id === f.room || r.occupied).map((r) => <option key={r.id} value={r.id}>{r.number}{r.type ? ` · ${r.type}` : ''}{r.occupied ? ' (guest now)' : ''}</option>)}</select></Label>
        {!f.room && <Label text="Room type"><select aria-label="Room type" className={field} value={f.type} onChange={(e) => set('type', e.target.value)}><option value="">Any</option>{[...new Map(chart.rooms.filter((r) => r.type_id).map((r) => [r.type_id!, r.type!])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Label>}
        <Label text="Rate per night in ₹"><input className={field} inputMode="decimal" value={f.rate} placeholder={typeRate ? String(typeRate / 100) : ''} onChange={(e) => set('rate', e.target.value)} /></Label>
        <Label text="Adults"><input className={field} inputMode="numeric" value={f.adults} onChange={(e) => set('adults', e.target.value)} /></Label>
        <Label text="Advance taken in ₹"><input className={field} inputMode="decimal" value={f.advance} onChange={(e) => set('advance', e.target.value)} /></Label>
        <Label text="Advance paid by"><select className={field} value={f.mode} onChange={(e) => set('mode', e.target.value)}>{PAY_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Label>
        <Label text="Booked through" hint="Phone, walk-in, Booking.com…"><input className={field} value={f.source} maxLength={40} onChange={(e) => set('source', e.target.value)} /></Label>
        <Label text="Notes"><input className={field} value={f.notes} maxLength={300} onChange={(e) => set('notes', e.target.value)} /></Label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className={ns.primary} disabled={!ok || busy}>{busy ? 'Saving…' : 'Save booking'}</button>
        <button type="button" className={ns.secondary} onClick={onClose}>Back</button>
      </div>
    </form>
  );
}

function ArrivePanel({ r, chart, flash, onClose, onDone }: { r: Reservation; chart: Chart; flash: Flash; onClose: () => void; onDone: () => void }) {
  const free = chart.rooms.filter(usableRoom);
  const [f, setF] = useState({ room: r.room_id ?? '', idType: '', idLast4: '', company: '', gstin: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ stay_id: string; room: string; stay_code: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const go = async () => {
    setBusy(true);
    try {
      setDone(await apiPost<{ stay_id: string; room: string; stay_code: string }>(`${API}/reservation-checkin`, { id: r.id, room: f.room || null, id_type: f.idType || null, id_last4: f.idLast4.trim() || null, company: f.company.trim() || null, gstin: f.gstin.trim() || null }));
    } catch (e) { flash(false, e instanceof ApiFailure && e.status === 409 ? 'That room is not free. Pick another room.' : errText(e, 'The guest could not be checked in. Please check the details.')); }
    setBusy(false);
  };
  if (done) {
    return (
      <div className={ns.card} data-testid="arrive-done">
        <p className={ns.label}>Room {done.room}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{r.guest_name} is checked in</h2>
        <p className="mt-3 text-sm text-stone-600">Stay code for the guest app (needed only if your hotel asks guests for a code):</p>
        <p className="mt-1 text-4xl font-semibold tracking-[.3em]" data-testid="stay-code">{done.stay_code}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className={ns.primary} href={`/padharosaa/billing?stay=${done.stay_id}`}>Open the bill</a>
          <button type="button" className={ns.secondary} onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }
  return (
    <form className={ns.card} onSubmit={(e) => { e.preventDefault(); if (f.room && !busy) void go(); }}>
      <h2 className="text-base font-semibold tracking-tight">Check in {r.guest_name} ({bookingNo(r.seq)})</h2>
      <p className="mt-1 text-sm text-stone-600">{dateLabel(r.check_in_on)} → {dateLabel(r.check_out_on)} · {r.nights} night{r.nights === 1 ? '' : 's'} · {rupees2(r.rate_paise)}/night{r.advance_paise ? ` · advance ${rupees2(r.advance_paise)} will be added to the bill` : ''}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Label text="Room"><select aria-label="Room" className={field} value={f.room} onChange={(e) => set('room', e.target.value)}><option value="">Choose a room…</option>{free.map((x) => <option key={x.id} value={x.id}>{x.number}{x.type ? ` · ${x.type}` : ''}{x.hk_status !== 'clean' ? ` (${x.hk_status === 'dirty' ? 'not cleaned yet' : x.hk_status})` : ''}</option>)}</select></Label>
        <Label text="ID shown"><select className={field} value={f.idType} onChange={(e) => set('idType', e.target.value)}><option value="">Not taken</option>{ID_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Label>
        <Label text="Last 4 of the ID number"><input className={field} value={f.idLast4} maxLength={4} autoComplete="off" onChange={(e) => set('idLast4', e.target.value)} /></Label>
        <Label text="Company (if the company pays)"><input className={field} value={f.company} maxLength={120} onChange={(e) => set('company', e.target.value)} /></Label>
        <Label text="Company GSTIN"><input className={field} value={f.gstin} maxLength={15} autoCapitalize="characters" onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></Label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className={ns.primary} disabled={!f.room || busy}>{busy ? 'Checking in…' : 'Check in'}</button>
        <button type="button" className={ns.secondary} onClick={onClose}>Back</button>
      </div>
    </form>
  );
}
