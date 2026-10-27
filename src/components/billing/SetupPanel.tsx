'use client';

import { useState, type ReactNode } from 'react';
import { apiPost } from '@/components/staff/hooks';
import { Card, ns } from '@/components/ui/ns';
import { parseRupeesToPaise, formatPaise } from '@/lib/money';
import { parsePercent, pct, type BillingSetup } from '@/lib/padharosaa/billing';
import { Label, errText, field, small, th, td, type Flash } from './common';

const API = '/api/padharosaa/v1/staff/billing';
type Save = (action: string, body: unknown, ok: string) => Promise<boolean>;

/** The hotel's own billing rules. Nothing is fixed in the software: the rates, what each charge is taxed at, and the extra charges are all set here. */
export function SetupPanel({ setup, reload, flash }: { setup: BillingSetup; reload: () => Promise<void>; flash: Flash }) {
  const save: Save = async (action, body, ok) => {
    try { await apiPost(`${API}/${action}`, body); flash(true, ok); await reload(); return true; } catch (e) { flash(false, errText(e)); return false; }
  };
  const rateName = (id: string | null) => setup.tax_rates.find((t) => t.id === id)?.name ?? 'No tax';
  return (
    <div data-testid="billing-setup">
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Set these once. Tax rates and rules change over time and differ for every hotel, so check them with your accountant. A change applies to bills that are still open; an invoice that is already made never changes.</p>
      <LegalCard setup={setup} save={save} />
      <RatesCard setup={setup} save={save} />
      <CategoriesCard setup={setup} save={save} />
      <SlabsCard setup={setup} save={save} rateName={rateName} />
      <ExtrasCard setup={setup} save={save} />
      <RoomTypesCard setup={setup} save={save} />
    </div>
  );
}

function RatePick({ setup, value, onChange, label = 'Tax' }: { setup: BillingSetup; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <select aria-label={label} className={small} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No tax</option>
      {setup.tax_rates.filter((t) => t.active || t.id === value).map((t) => <option key={t.id} value={t.id}>{t.name} ({pct(t.rate_bp)})</option>)}
    </select>
  );
}

function LegalCard({ setup, save }: { setup: BillingSetup; save: Save }) {
  const s = setup.settings;
  const [f, setF] = useState({ legal: s.legal_name ?? '', gstin: s.gstin ?? '', address: s.address ?? '', prefix: s.prefix, terms: s.terms ?? '', round: s.round_off });
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Invoice details" hint="Printed at the top and bottom of every invoice.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await save('legal', { legal_name: f.legal.trim() || null, gstin: f.gstin.trim() || null, address: f.address.trim() || null, prefix: f.prefix.trim() || 'INV', terms: f.terms.trim() || null, round_off: f.round }, 'Invoice details saved.'); setBusy(false); }}>
        <Label text="Name on the invoice"><input className={field} value={f.legal} maxLength={120} onChange={(e) => setF({ ...f, legal: e.target.value })} /></Label>
        <Label text="Hotel GSTIN" hint="15 characters. Leave empty if not registered."><input className={field} value={f.gstin} maxLength={15} autoCapitalize="characters" onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Label>
        <Label text="Address"><textarea className={`${field} py-2`} rows={2} value={f.address} maxLength={300} onChange={(e) => setF({ ...f, address: e.target.value })} /></Label>
        <Label text="Terms at the bottom" hint="For example the check-out time or a refund note."><textarea className={`${field} py-2`} rows={2} value={f.terms} maxLength={400} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Label>
        <Label text="Invoice number starts with" hint={`Only letters and numbers, up to 8 (for example INV or SURA); the slash and the year are added by themselves. Numbers run ${f.prefix || 'INV'}/2026-27/0001, 0002... and start again each April.`}><input className={field} value={f.prefix} maxLength={8} autoCapitalize="characters" onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></Label>
        <label className="flex min-h-11 items-center gap-3 self-end text-sm font-semibold"><input type="checkbox" className="size-5" checked={f.round} onChange={(e) => setF({ ...f, round: e.target.checked })} />Round the total to the nearest rupee</label>
        <div className="sm:col-span-2"><button type="submit" className={ns.primary} disabled={busy}>Save invoice details</button></div>
      </form>
    </Card>
  );
}

function RatesCard({ setup, save }: { setup: BillingSetup; save: Save }) {
  const [name, setName] = useState('');
  const [pc, setPc] = useState('');
  const bp = parsePercent(pc);
  return (
    <Card title="Tax rates" hint="The rates your hotel uses. CGST and SGST are each half of the rate; another state's guests are charged IGST.">
      {setup.tax_rates.length === 0 && <p className="mb-3 text-sm font-semibold text-amber-900">No rates yet. Add your own, or start from the common ones.</p>}
      <ul className="divide-y divide-stone-100">
        {setup.tax_rates.map((t) => <RateRow key={`${t.id}-${t.name}-${t.rate_bp}-${t.active}`} t={t} save={save} />)}
      </ul>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && bp !== null && await save('tax-rate', { name: name.trim(), rate_bp: bp, active: true }, 'Rate added.')) { setName(''); setPc(''); } }}>
        <Label text="New rate name"><input className={`${field} !mt-1 w-44`} value={name} maxLength={40} placeholder="GST 5%" onChange={(e) => setName(e.target.value)} /></Label>
        <Label text="Percent"><input className={`${field} !mt-1 w-24`} value={pc} inputMode="decimal" placeholder="5" onChange={(e) => setPc(e.target.value)} /></Label>
        <button type="submit" className={ns.primary} disabled={!name.trim() || bp === null}>Add rate</button>
        <button type="button" className={ns.secondary} onClick={() => void save('tax-presets', {}, 'Common rates added.')}>Add common rates (0, 5, 12, 18%)</button>
      </form>
    </Card>
  );
}
function RateRow({ t, save }: { t: BillingSetup['tax_rates'][number]; save: Save }) {
  const [name, setName] = useState(t.name);
  const [pc, setPc] = useState(String(t.rate_bp / 100));
  const bp = parsePercent(pc);
  const dirty = name.trim() !== t.name || bp !== t.rate_bp;
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <input aria-label="Rate name" className={`${small} w-40`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Percent" className={`${small} w-20`} value={pc} inputMode="decimal" onChange={(e) => setPc(e.target.value)} /><span className="text-sm text-stone-500">%</span>
      <button type="button" className={`${ns.secondary} !min-h-9`} disabled={!dirty || bp === null || !name.trim()} onClick={() => void save('tax-rate', { id: t.id, name: name.trim(), rate_bp: bp, active: t.active }, 'Rate saved.')}>Save</button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={t.active} onChange={(e) => void save('tax-rate', { id: t.id, name: t.name, rate_bp: t.rate_bp, active: e.target.checked }, e.target.checked ? 'Rate is in use.' : 'Rate is hidden from the lists.')} />In use</label>
    </li>
  );
}

function CategoriesCard({ setup, save }: { setup: BillingSetup; save: Save }) {
  const [name, setName] = useState('');
  return (
    <Card title="What each charge is taxed at" hint="Every line on a bill belongs to one of these. Choose its tax. The SAC code is printed beside it if you enter one.">
      <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b border-stone-200"><th className={th}>Charge</th><th className={th}>SAC code</th><th className={th}>Tax</th></tr></thead>
        <tbody>{setup.categories.map((c) => <CategoryRow key={`${c.id}-${c.tax_rate_id}-${c.sac}-${c.active}`} c={c} setup={setup} save={save} />)}</tbody></table></div>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && await save('category', { name: name.trim(), sac: null, tax_rate_id: null, active: true }, 'Charge added.')) setName(''); }}>
        <Label text="New kind of charge"><input className={`${field} !mt-1 w-56`} value={name} maxLength={40} placeholder="Spa, Airport pickup..." onChange={(e) => setName(e.target.value)} /></Label>
        <button type="submit" className={ns.primary} disabled={!name.trim()}>Add</button>
      </form>
    </Card>
  );
}
function CategoryRow({ c, setup, save }: { c: BillingSetup['categories'][number]; setup: BillingSetup; save: Save }) {
  const [sac, setSac] = useState(c.sac ?? '');
  const [tax, setTax] = useState(c.tax_rate_id ?? '');
  const dirty = sac.trim() !== (c.sac ?? '') || tax !== (c.tax_rate_id ?? '');
  return (
    <tr className="border-b border-stone-100">
      <td className={td}>{c.name}{c.kind !== 'other' && <span className="ml-2 text-xs text-stone-400">{c.kind === 'room' ? 'room rent' : 'room service food'}</span>}</td>
      <td className={td}><input aria-label={`SAC code for ${c.name}`} className={`${small} w-24`} value={sac} maxLength={8} inputMode="numeric" onChange={(e) => setSac(e.target.value)} /></td>
      <td className={td}><span className="flex flex-wrap items-center gap-2"><RatePick setup={setup} value={tax} onChange={setTax} label={`Tax for ${c.name}`} />
        <button type="button" className={`${ns.secondary} !min-h-9`} disabled={!dirty} onClick={() => void save('category', { id: c.id, name: c.name, sac: sac.trim() || null, tax_rate_id: tax || null, active: c.active }, `${c.name} saved.`)}>Save</button></span></td>
    </tr>
  );
}

function SlabsCard({ setup, save, rateName }: { setup: BillingSetup; save: Save; rateName: (id: string | null) => string }) {
  const toRows = () => setup.slabs.map((s) => ({ upTo: s.up_to_paise === null ? '' : String(s.up_to_paise / 100), tax: s.tax_rate_id }));
  const [rows, setRows] = useState(toRows);
  const parsed = rows.map((r) => ({ up: r.upTo.trim() === '' ? null : parseRupeesToPaise(r.upTo), tax: r.tax }));
  const valid = rows.every((r, i) => r.tax && (r.upTo.trim() === '' ? i === rows.length - 1 : parsed[i]!.up !== null && parsed[i]!.up! > 0 && (i === 0 || (parsed[i - 1]!.up ?? 0) < parsed[i]!.up!)));
  const upd = (i: number, k: 'upTo' | 'tax', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card title="Room tax by the rate per night" hint="Some hotels charge a different tax on the room depending on its price per night. Add the steps lowest first; the last step can have no limit. With no steps, the room uses the tax set for 'Room rent' above.">
      {rows.length > 0 && (
        <ul className="space-y-2" data-testid="slabs">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{i === 0 ? 'Rooms up to' : 'Above that, up to'}</span>
              <input aria-label={`Step ${i + 1} limit in rupees`} className={`${small} w-28`} value={r.upTo} inputMode="decimal" placeholder="no limit" onChange={(e) => upd(i, 'upTo', e.target.value)} /><span>₹ per night</span>
              <RatePick setup={setup} value={r.tax} onChange={(v) => upd(i, 'tax', v)} label={`Step ${i + 1} tax`} />
              <button type="button" className="text-sm font-semibold text-red-800 underline" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={ns.secondary} disabled={rows.length >= 8 || (rows.length > 0 && rows[rows.length - 1]!.upTo.trim() === '')} onClick={() => setRows([...rows, { upTo: '', tax: '' }])}>+ Add a step</button>
        <button type="button" className={ns.primary} disabled={!valid} onClick={() => void save('slabs', { items: parsed.map((p) => ({ up_to_paise: p.up, tax_rate_id: p.tax })) }, rows.length ? 'Room tax steps saved.' : 'Room tax steps removed.')}>Save</button>
      </div>
      {setup.slabs.length > 0 && <p className="mt-2 text-xs text-stone-500">Saved: {setup.slabs.map((s) => `${s.up_to_paise === null ? 'above' : `up to ${formatPaise(s.up_to_paise)}`} → ${rateName(s.tax_rate_id)}`).join(' · ')}</p>}
    </Card>
  );
}

const MODES = [['percent', '% of the bill'], ['per_night', '₹ every night'], ['flat', '₹ once']] as const;
const APPLIES = [['room', 'Room rent'], ['food', 'Room service food'], ['all', 'Everything']] as const;
function ExtrasCard({ setup, save }: { setup: BillingSetup; save: Save }) {
  const blank = { name: '', mode: 'percent', value: '', applies: 'room', tax: '' };
  const [n, setN] = useState(blank);
  const val = (mode: string, v: string) => (mode === 'percent' ? parsePercent(v) : parseRupeesToPaise(v));
  const nv = val(n.mode, n.value);
  return (
    <Card title="Extra charges on every bill" hint="Your own extra columns, for example a service charge in percent or a tourism fee per night. Each can have its own tax, or none.">
      {setup.extras.length === 0 && <p className="mb-3 text-sm text-stone-600">None yet.</p>}
      <ul className="divide-y divide-stone-100">{setup.extras.map((e) => <ExtraRow key={`${e.id}-${e.name}-${e.mode}-${e.value}-${e.applies_to}-${e.tax_rate_id}-${e.active}`} e={e} setup={setup} save={save} val={val} />)}</ul>
      <form className="mt-3 grid gap-2 sm:grid-cols-5" onSubmit={async (e) => { e.preventDefault(); if (n.name.trim() && nv !== null && await save('extra', { name: n.name.trim(), mode: n.mode, value: nv, applies_to: n.applies, tax_rate_id: n.tax || null, active: true }, 'Extra charge added.')) setN(blank); }}>
        <Label text="Name"><input className={`${field} !mt-1`} value={n.name} maxLength={40} placeholder="Service charge" onChange={(e) => setN({ ...n, name: e.target.value })} /></Label>
        <Label text="How"><select className={`${field} !mt-1`} value={n.mode} onChange={(e) => setN({ ...n, mode: e.target.value, value: '' })}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Label>
        <Label text={n.mode === 'percent' ? 'Percent' : 'Amount in ₹'}><input className={`${field} !mt-1`} inputMode="decimal" value={n.value} onChange={(e) => setN({ ...n, value: e.target.value })} /></Label>
        <Label text="Charged on"><select className={`${field} !mt-1`} value={n.applies} onChange={(e) => setN({ ...n, applies: e.target.value })}>{APPLIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Label>
        <div className="flex items-end gap-2"><label className="block flex-1 text-sm font-semibold">Its tax<span className="mt-1 block"><RatePick setup={setup} value={n.tax} onChange={(v) => setN({ ...n, tax: v })} label="Tax on the new extra charge" /></span></label>
          <button type="submit" className={ns.primary} disabled={!n.name.trim() || nv === null}>Add</button></div>
      </form>
    </Card>
  );
}
function ExtraRow({ e, setup, save, val }: { e: BillingSetup['extras'][number]; setup: BillingSetup; save: Save; val: (mode: string, v: string) => number | null }) {
  const shown = e.mode === 'percent' ? String(e.value / 100) : String(e.value / 100);
  const [v, setV] = useState(shown);
  const [tax, setTax] = useState(e.tax_rate_id ?? '');
  const nv = val(e.mode, v);
  const dirty = nv !== e.value || tax !== (e.tax_rate_id ?? '');
  const body = (over: Partial<{ value: number; tax_rate_id: string | null; active: boolean }>) => ({ id: e.id, name: e.name, mode: e.mode, value: e.value, applies_to: e.applies_to, tax_rate_id: e.tax_rate_id, active: e.active, ...over });
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <span className="min-w-36 font-semibold">{e.name}</span>
      <span className="text-stone-500">{MODES.find((m) => m[0] === e.mode)![1]} · {APPLIES.find((a) => a[0] === e.applies_to)![1]}</span>
      <input aria-label={`Value of ${e.name}`} className={`${small} w-24`} value={v} inputMode="decimal" onChange={(x) => setV(x.target.value)} />
      <RatePick setup={setup} value={tax} onChange={setTax} label={`Tax on ${e.name}`} />
      <button type="button" className={`${ns.secondary} !min-h-9`} disabled={!dirty || nv === null} onClick={() => void save('extra', body({ value: nv!, tax_rate_id: tax || null }), `${e.name} saved.`)}>Save</button>
      <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={e.active} onChange={(x) => void save('extra', body({ active: x.target.checked }), x.target.checked ? `${e.name} is on.` : `${e.name} is off.`)} />On</label>
    </li>
  );
}

function RoomTypesCard({ setup, save }: { setup: BillingSetup; save: Save }) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [max, setMax] = useState('2');
  const paise = parseRupeesToPaise(rate);
  return (
    <Card title="Room types and rates" hint="A room type has a normal rate per night. Check-in uses it, and you can still change it for one guest.">
      <ul className="divide-y divide-stone-100">{setup.room_types.map((t) => <TypeRow key={`${t.id}-${t.name}-${t.rate_paise}-${t.max_guests}-${t.active}`} t={t} save={save} />)}</ul>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && paise !== null && await save('room-type', { name: name.trim(), rate_paise: paise, max_guests: Number(max) || 2, active: true }, 'Room type added.')) { setName(''); setRate(''); } }}>
        <Label text="New room type"><input className={`${field} !mt-1 w-44`} value={name} maxLength={40} placeholder="Deluxe" onChange={(e) => setName(e.target.value)} /></Label>
        <Label text="Rate per night in ₹"><input className={`${field} !mt-1 w-32`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Label>
        <Label text="Guests"><input className={`${field} !mt-1 w-20`} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} /></Label>
        <button type="submit" className={ns.primary} disabled={!name.trim() || paise === null}>Add</button>
      </form>
      {setup.room_types.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Which type is each room?</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {setup.rooms.filter((r) => r.active).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm">
                <span className="font-semibold">Room {r.number}</span>
                <select aria-label={`Type of room ${r.number}`} className={small} value={r.room_type_id ?? ''} onChange={(e) => void save('room-type-set', { room: r.id, type: e.target.value || null }, `Room ${r.number} saved.`)}>
                  <option value="">No type</option>
                  {setup.room_types.filter((t) => t.active || t.id === r.room_type_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
function TypeRow({ t, save }: { t: BillingSetup['room_types'][number]; save: Save }): ReactNode {
  const [name, setName] = useState(t.name);
  const [rate, setRate] = useState(String(t.rate_paise / 100));
  const paise = parseRupeesToPaise(rate);
  const dirty = name.trim() !== t.name || paise !== t.rate_paise;
  const body = (over: object) => ({ id: t.id, name: t.name, rate_paise: t.rate_paise, max_guests: t.max_guests, active: t.active, ...over });
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <input aria-label="Room type name" className={`${small} w-40`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <span className="text-stone-500">₹</span><input aria-label={`Rate of ${t.name}`} className={`${small} w-28`} value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} /><span className="text-stone-500">per night</span>
      <button type="button" className={`${ns.secondary} !min-h-9`} disabled={!dirty || paise === null || !name.trim()} onClick={() => void save('room-type', body({ name: name.trim(), rate_paise: paise }), `${t.name} saved.`)}>Save</button>
      <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={t.active} onChange={(e) => void save('room-type', body({ active: e.target.checked }), e.target.checked ? 'Room type is in use.' : 'Room type is hidden.')} />In use</label>
    </li>
  );
}
