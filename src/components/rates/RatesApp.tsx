'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ns } from '@/components/ui/ns';
import { Label, errText, field } from '@/components/billing/common';
import { dayFromToday, rupees2, type BillingSetup } from '@/lib/padharosaa/billing';
import { WEEKDAYS, daysInMonth, firstOfMonth, leadingBlanks, monthShift, type RateCalendar } from '@/lib/padharosaa/frontoffice';
import { parseRupeesToPaise } from '@/lib/money';
import { ApiFailure } from '@/lib/guest/client';

const API = '/api/padharosaa/v1/staff';
type TypeRow = BillingSetup['room_types'][number];

/** Prices: pick a room type, then its month. Click a day (or two days for a range) to change the price, stop selling or set a minimum stay. */
export function RatesApp({ role }: { role: string }) {
  const boss = role === 'owner' || role === 'manager';
  const [setup, setSetup] = useState<BillingSetup | null>(null);
  const [type, setType] = useState<TypeRow | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = useCallback((ok: boolean, text: string) => { setMsg({ ok, text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  useEffect(() => { void (async () => { try { setSetup(await apiGet<BillingSetup>(`${API}/billing`)); } catch (e) { flash(false, errText(e, 'The room types could not be loaded.')); } })(); }, [flash]);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-3 text-stone-900">
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mb-3 rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{msg.text}</p>}
      {type ? <Calendar type={type} boss={boss} flash={flash} onBack={() => setType(null)} /> : (
        <>
          <p className="text-sm text-stone-600">Choose a room type to see and change its price for every day of the month.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="rate-types">
            {setup?.room_types.filter((t) => t.active).map((t) => (
              <button key={t.id} type="button" onClick={() => setType(t)} className="rounded-xl border border-stone-200 bg-white p-4 text-left hover:border-indigo-400">
                <p className="text-lg font-semibold">{t.name}</p>
                <p className="mt-1 text-sm text-stone-600">Everyday price {rupees2(t.rate_paise)} · {setup.rooms.filter((r) => r.active && r.room_type_id === t.id).length} rooms</p>
                <p className="mt-2 text-sm font-semibold text-indigo-900">Open the calendar →</p>
              </button>
            ))}
            {setup && setup.room_types.filter((t) => t.active).length === 0 && <p className="text-sm text-stone-600">No room types yet. Add them under Billing → Taxes &amp; rates → Room types and rates, and give each room a type.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function Calendar({ type, boss, flash, onBack }: { type: TypeRow; boss: boolean; flash: (ok: boolean, t: string) => void; onBack: () => void }) {
  const [first, setFirst] = useState(firstOfMonth(dayFromToday(0)));
  const [cal, setCal] = useState<RateCalendar | null>(null);
  const [pick, setPick] = useState<{ a: string; b: string } | null>(null);
  const [f, setF] = useState({ rate: '', stop: '', min: '', wd: [] as string[] });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setCal(await apiGet<RateCalendar>(`${API}/frontoffice/rates?type=${type.id}&from=${first}&days=${daysInMonth(first)}`)); } catch (e) { flash(false, errText(e, 'The calendar could not be loaded.')); }
  }, [type.id, first, flash]);
  useEffect(() => { void load(); }, [load]);

  const today = cal?.today ?? dayFromToday(0);
  const lo = pick ? (pick.a <= pick.b ? pick.a : pick.b) : null;
  const hi = pick ? (pick.a <= pick.b ? pick.b : pick.a) : null;
  const click = (d: string) => { if (!boss || d < today) return; setPick((p) => (!p || p.a !== p.b ? { a: d, b: d } : { a: p.a, b: d })); };
  const ratePaise = f.rate.trim() ? parseRupeesToPaise(f.rate) : null;
  const minN = f.min.trim() === '' ? null : Number(f.min);
  const valid = !!pick && (f.rate.trim() === '' || ratePaise !== null) && (minN === null || (Number.isInteger(minN) && minN >= 0 && minN <= 30)) && (f.rate.trim() !== '' || f.stop !== '' || minN !== null);

  const apply = async (reset: boolean) => {
    if (!lo || !hi) return;
    setBusy(true);
    try {
      await apiPost(`${API}/frontoffice/rates`, { type: type.id, from: lo, to: hi, rate_paise: reset ? null : ratePaise, stop_sell: reset || f.stop === '' ? null : f.stop === 'stop', min_stay: reset ? null : minN, weekdays: f.wd, reset });
      flash(true, reset ? 'Back to the everyday price.' : 'Saved.');
      setPick(null); setF({ rate: '', stop: '', min: '', wd: [] });
      await load();
    } catch (e) { flash(false, e instanceof ApiFailure && e.status === 400 ? 'Please check the dates and the price. Past days cannot be changed.' : errText(e)); }
    setBusy(false);
  };
  const cells = useMemo(() => cal?.days ?? [], [cal]);
  const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T00:00:00Z`));

  return (
    <section aria-label={`${type.name} prices`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ns.secondary} onClick={onBack}>← Room types</button>
        <h2 className="mr-auto text-lg font-semibold tracking-tight">{type.name} <span className="text-sm font-normal text-stone-600">everyday {rupees2(type.rate_paise)}</span></h2>
        <button type="button" className={ns.secondary} aria-label="Earlier month" onClick={() => { setPick(null); setFirst(monthShift(first, -1)); }}>←</button>
        <b className="min-w-32 text-center text-sm" data-testid="rate-month">{monthName}</b>
        <button type="button" className={ns.secondary} aria-label="Later month" onClick={() => { setPick(null); setFirst(monthShift(first, 1)); }}>→</button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-stone-500">{WEEKDAYS.map(([k, l]) => <div key={k}>{l}</div>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1" data-testid="rate-grid">
        {Array.from({ length: leadingBlanks(first) }, (_, i) => <div key={`b${i}`} />)}
        {cells.map((c) => {
          const past = c.day < today;
          const sel = lo !== null && hi !== null && c.day >= lo && c.day <= hi;
          return (
            <button key={c.day} type="button" disabled={past || !boss} onClick={() => click(c.day)} aria-pressed={sel} aria-label={`${c.day} ${rupees2(c.rate_paise)}${c.stop_sell ? ' stop sell' : ''}`}
              className={`min-h-[4.25rem] rounded-lg border p-1.5 text-left text-xs ${past ? 'border-stone-100 bg-stone-50 text-stone-400' : sel ? 'border-indigo-700 bg-indigo-50' : c.stop_sell ? 'border-red-300 bg-red-50' : c.custom ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white hover:border-indigo-300'}`}>
              <span className="flex justify-between"><b className="text-sm">{Number(c.day.slice(8))}</b><span className={c.free === 0 ? 'font-semibold text-red-700' : 'text-stone-500'}>{c.free} free</span></span>
              <span className="mt-0.5 block text-sm font-semibold">{c.stop_sell ? 'Closed' : rupees2(c.rate_paise).replace('.00', '')}</span>
              {c.min_stay && <span className="block text-[10px] text-stone-600">min {c.min_stay} nights</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600"><span><i className="mr-1 inline-block h-3 w-3 rounded border border-amber-300 bg-amber-50 align-middle" />changed price</span><span><i className="mr-1 inline-block h-3 w-3 rounded border border-red-300 bg-red-50 align-middle" />closed for sale</span><span>“free” = rooms of this type still open to sell that night</span></p>
      {!boss && <p className="mt-3 text-sm text-stone-600">Only the owner and manager change prices.</p>}
      {boss && !pick && <p className="mt-3 text-sm text-stone-600">Tap a day, then tap another day to choose a range. A single tap is one day.</p>}
      {boss && pick && lo && hi && (
        <form className={`mt-4 ${ns.card}`} onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void apply(false); }} aria-label="Change prices">
          <h3 className="text-base font-semibold tracking-tight">{lo === hi ? lo : `${lo} to ${hi}`}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Label text="Price per night in ₹" hint="Leave empty to keep it"><input className={field} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Label>
            <Label text="Sale"><select aria-label="Sale" className={field} value={f.stop} onChange={(e) => setF({ ...f, stop: e.target.value })}><option value="">Keep as it is</option><option value="stop">Stop selling these days</option><option value="open">Open for sale</option></select></Label>
            <Label text="Minimum nights" hint="0 removes it; empty keeps it"><input className={field} inputMode="numeric" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Label>
          </div>
          {lo !== hi && (
            <fieldset className="mt-3"><legend className="text-sm font-semibold">Only on these days (none = every day)</legend>
              <div className="mt-1 flex flex-wrap gap-2">{WEEKDAYS.map(([k, l]) => <label key={k} className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold ${f.wd.includes(k) ? 'border-indigo-900 bg-indigo-50' : 'border-stone-300'}`}><input type="checkbox" checked={f.wd.includes(k)} onChange={() => setF((p) => ({ ...p, wd: p.wd.includes(k) ? p.wd.filter((x) => x !== k) : [...p.wd, k] }))} />{l}</label>)}</div>
            </fieldset>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" className={ns.primary} disabled={!valid || busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className={ns.secondary} disabled={busy} onClick={() => void apply(true)}>Back to everyday price</button>
            <button type="button" className={ns.secondary} onClick={() => setPick(null)}>Clear selection</button>
          </div>
        </form>
      )}
    </section>
  );
}
