'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ns } from '@/components/ui/ns';
import { PAY_MODES, dateLabel, payModeLabel, pct, rupees2, type BillingSetup, type FolioResponse } from '@/lib/padharosaa/billing';
import { parseRupeesToPaise } from '@/lib/money';
import { Label, errText, field, td, th, type Flash } from './common';

const API = '/api/padharosaa/v1/staff';

/** One guest's bill: what is on it, the tax by rate, the payments, and the way out (payment, then check-out with the invoice). */
export function FolioView({ stayId, setup, flash, onBack, onChanged }: { stayId: string; setup: BillingSetup; flash: Flash; onBack: () => void; onChanged: () => void }) {
  const [d, setD] = useState<FolioResponse | null>(null);
  const [preview, setPreview] = useState<FolioResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | 'charge' | 'pay' | 'edit'>(null);
  const load = useCallback(async () => {
    try {
      const r = await apiGet<FolioResponse>(`${API}/stays/${stayId}`);
      setD(r);
      setPreview(r.folio.stay.status === 'in_house' ? await apiGet<FolioResponse>(`${API}/stays/${stayId}?checkout=1`) : null);
    } catch (e) { flash(false, errText(e, 'The bill could not be loaded.')); }
  }, [stayId, flash]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); flash(true, ok); setPanel(null); await load(); onChanged(); } catch (e) { flash(false, errText(e)); }
    setBusy(false);
  };

  if (!d) return <p className="mt-6" role="status">…</p>;
  const f = d.folio;
  const s = f.stay;
  const open = s.status === 'in_house' && !d.invoice; // an invoice is a frozen copy: its stay still says in-house, the bill is closed
  const after = preview?.folio ?? f; // what it comes to if the guest leaves today
  const rest = after.balance_paise;
  // the room-service orders that are on the bill now, one row for each order (its dishes are the lines above)
  const orders = Object.values(f.lines.reduce<Record<string, { id: string; no: string; dishes: number; amount: number }>>((m, l) => {
    if (l.src !== 'order' || !l.order_id) return m;
    const o = m[l.order_id] ?? { id: l.order_id, no: /order #(\d+)/.exec(l.description)?.[1] ?? '', dishes: 0, amount: 0 };
    o.dishes += 1; o.amount += l.amount_paise; m[l.order_id] = o;
    return m;
  }, {}));
  const skipped = d.skipped_orders ?? [];
  const taxLabel = (bp: number) => (bp === 0 ? 'No tax' : pct(bp));

  return (
    <div className="mt-4" data-testid="folio">
      <button type="button" className={`${ns.secondary} !min-h-9`} onClick={onBack}>← All guests</button>
      <section className={`mt-3 ${ns.card}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={ns.label}>Room {s.room}{s.room_type ? ` · ${s.room_type}` : ''}</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">{s.guest_name}</h2>
            <p className="mt-1 text-sm text-stone-600">
              {s.company_name ? `${s.company_name}${s.company_gstin ? ` · GSTIN ${s.company_gstin}` : ''} · ` : ''}
              {dateLabel(s.check_in_at)} to {dateLabel(s.check_out_on)} · {s.nights} night{s.nights === 1 ? '' : 's'} at {rupees2(s.rate_paise)}
              {s.inter_state ? ' · IGST (other state)' : ''}
            </p>
          </div>
          <div className="text-right">
            {d.invoice ? <p className="text-sm font-semibold">Invoice {d.invoice.number}</p> : <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-900">In the hotel</span>}
            <p className="mt-1 text-2xl font-semibold tracking-tight" data-testid="folio-balance">{rupees2(f.balance_paise)}</p>
            <p className="text-xs text-stone-500">{f.balance_paise < 0 ? 'to give back' : 'balance'}</p>
          </div>
        </div>
        {open && <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={ns.secondary} onClick={() => setPanel(panel === 'edit' ? null : 'edit')}>Change rate or check-out day</button>
        </div>}
        {open && panel === 'edit' && <EditStay key={`${s.rate_paise}-${s.check_out_on}`} rate={s.rate_paise} outOn={s.check_out_on} busy={busy} save={(body) => run(() => apiPost(`${API}/stays/${stayId}/update`, body), 'Saved.')} />}
        {open && <p className="mt-2 text-xs text-stone-500">Nights are counted up to the planned check-out day, or up to today if the guest stays longer.</p>}
      </section>

      <section className={`mt-4 ${ns.card} !p-0 overflow-x-auto`}>
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-stone-200 bg-stone-50"><th className={th}>Item</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Tax</th>{open && <th className={th}><span className="sr-only">Edit</span></th>}</tr></thead>
          <tbody>
            {f.lines.map((l, i) => {
              const key = l.line_id ?? '';
              const canEdit = open && !!l.line_id && (l.src === 'order' || l.src === 'manual');
              return (
                <Fragment key={i}>
                  <tr className="border-b border-stone-100">
                    <td className={td}>{l.description}{l.sac ? <span className="ml-2 text-xs text-stone-400">SAC {l.sac}</span> : null}</td>
                    <td className={`${td} text-right tabular-nums`}>{l.qty}</td>
                    <td className={`${td} text-right tabular-nums`}>{rupees2(l.amount_paise)}</td>
                    <td className={`${td} text-right text-stone-500`}>{taxLabel(l.tax_bp)}</td>
                    {open && <td className={td}>{canEdit && <button type="button" className="text-sm font-semibold text-indigo-800 underline" aria-label={`Edit ${l.description}`} onClick={() => setEditing(editing === key ? null : key)}>Edit</button>}</td>}
                  </tr>
                  {canEdit && editing === key && (
                    <tr className="border-b border-stone-100 bg-stone-50"><td colSpan={5} className="px-3 py-3">
                      <LineEdit line={l} setup={setup} busy={busy}
                        saveItem={(b: object) => run(() => apiPost(`${API}/stays/${stayId}/item-edit`, { item: key, ...b }), 'Saved.')}
                        saveLine={(b: object) => run(() => apiPost(`${API}/stays/${stayId}/line-edit`, { line: key, ...b }), 'Saved.')} />
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <div className="space-y-1 border-t border-stone-200 bg-stone-50 p-4 text-sm" data-testid="folio-totals">
          <div className="flex justify-between"><span>Amount before tax</span><span className="tabular-nums">{rupees2(f.subtotal_paise)}</span></div>
          {f.tax_groups.filter((g) => g.tax_paise !== 0).map((g) => (
            s.inter_state
              ? <div key={g.tax_bp} className="flex justify-between text-stone-600"><span>IGST {pct(g.tax_bp)} on {rupees2(g.taxable_paise)}</span><span className="tabular-nums">{rupees2(g.igst_paise)}</span></div>
              : <div key={g.tax_bp} className="flex justify-between text-stone-600"><span>CGST {pct(g.tax_bp / 2)} + SGST {pct(g.tax_bp / 2)} on {rupees2(g.taxable_paise)}</span><span className="tabular-nums">{rupees2(g.tax_paise)}</span></div>
          ))}
          {f.round_off_paise !== 0 && <div className="flex justify-between text-stone-600"><span>Round off</span><span className="tabular-nums">{rupees2(f.round_off_paise)}</span></div>}
          <div className="flex justify-between border-t border-stone-300 pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{rupees2(f.total_paise)}</span></div>
          <div className="flex justify-between text-stone-600"><span>Paid so far</span><span className="tabular-nums">{rupees2(f.paid_paise)}</span></div>
          <div className="flex justify-between text-base font-semibold"><span>Balance</span><span className="tabular-nums">{rupees2(f.balance_paise)}</span></div>
        </div>
      </section>

      {f.payments.length > 0 && (
        <section className={`mt-4 ${ns.card}`}>
          <h3 className="text-sm font-semibold">Payments</h3>
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {f.payments.map((p) => (
              <li key={p.id} className="flex justify-between py-2"><span>{p.kind === 'refund' ? 'Given back' : p.kind === 'advance' ? 'Advance' : 'Payment'} · {payModeLabel(p.mode)}{p.ref ? ` · ${p.ref}` : ''}</span><span className="tabular-nums">{p.kind === 'refund' ? '−' : ''}{rupees2(p.amount_paise)}</span></li>
            ))}
          </ul>
        </section>
      )}

      {open && (orders.length > 0 || skipped.length > 0 || (d.removed_items ?? []).length > 0) && (
        <section className={`mt-4 ${ns.card}`} data-testid="room-orders">
          <h3 className="text-sm font-semibold">Room service on this bill</h3>
          {orders.length > 0 && <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {orders.map((o) => <OrderRow key={o.id} label={`Order #${o.no} · ${o.dishes} ${o.dishes === 1 ? 'line' : 'lines'}`} amount={o.amount} busy={busy} onCross={(reason) => run(() => apiPost(`${API}/stays/${stayId}/order-skip`, { order: o.id, skip: true, reason }), `Order #${o.no} crossed out.`)} />)}
          </ul>}
          {(d.removed_items ?? []).length > 0 && <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Dishes taken off the bill</p>
            <ul className="mt-1 divide-y divide-stone-100 text-sm">
              {(d.removed_items ?? []).map((k) => (
                <li key={k.item_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{k.name} × {k.qty} · order #{k.order_no}</span>
                  <button type="button" className="text-sm font-semibold text-indigo-800 underline" disabled={busy} onClick={() => void run(() => apiPost(`${API}/stays/${stayId}/item-edit`, { item: k.item_id, removed: false }), `${k.name} is back on the bill.`)}>Put back</button>
                </li>
              ))}
            </ul>
          </>}
          {skipped.length > 0 && <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Crossed out (not on the bill)</p>
            <ul className="mt-1 divide-y divide-stone-100 text-sm">
              {skipped.map((k) => (
                <li key={k.order_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>Order #{k.order_no} · {rupees2(k.total_paise)}<span className="block text-xs text-stone-500">{k.reason}</span></span>
                  <button type="button" className="text-sm font-semibold text-indigo-800 underline" disabled={busy} onClick={() => void run(() => apiPost(`${API}/stays/${stayId}/order-skip`, { order: k.order_id, skip: false }), `Order #${k.order_no} is back on the bill.`)}>Put back</button>
                </li>
              ))}
            </ul>
          </>}
        </section>
      )}

      {open && d.lines && d.lines.length > 0 && (
        <section className={`mt-4 ${ns.card}`}>
          <h3 className="text-sm font-semibold">Charges added at the desk</h3>
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {d.lines.map((l) => <VoidRow key={l.id} line={l} busy={busy} onVoid={(reason) => run(() => apiPost(`${API}/folio-lines/${l.id}/void`, { reason }), 'Crossed out.')} />)}
          </ul>
        </section>
      )}

      {open && (
        <section className={`mt-4 ${ns.card}`}>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ns.secondary} onClick={() => setPanel(panel === 'charge' ? null : 'charge')}>+ Add a charge</button>
            <button type="button" className={ns.secondary} onClick={() => setPanel(panel === 'pay' ? null : 'pay')}>+ Record a payment</button>
          </div>
          {panel === 'charge' && <ChargeForm setup={setup} busy={busy} save={(body) => run(() => apiPost(`${API}/stays/${stayId}/charges`, body), 'Charge added.')} />}
          {panel === 'pay' && <PayForm balance={rest} busy={busy} save={(body) => run(() => apiPost(`${API}/stays/${stayId}/payments`, body), 'Payment recorded.')} />}
        </section>
      )}

      {open && (
        <section className={`mt-4 ${ns.card} border-indigo-200`} data-testid="checkout-card">
          <h3 className="text-base font-semibold">Check-out</h3>
          <p className="mt-1 text-sm text-stone-600">
            If {s.guest_name.split(' ')[0]} leaves today: {after.stay.nights} night{after.stay.nights === 1 ? '' : 's'}, total {rupees2(after.total_paise)}, paid {rupees2(after.paid_paise)}.
          </p>
          {rest > 0 && <p className="mt-2 text-sm font-semibold text-amber-900" role="status">{rupees2(rest)} is still to be collected. Record the payment first.</p>}
          {rest < 0 && <p className="mt-2 text-sm font-semibold text-amber-900" role="status">{rupees2(-rest)} was paid too much. Record it as given back first.</p>}
          <button type="button" className={`${ns.primary} mt-3`} disabled={busy || rest !== 0}
            onClick={() => { if (window.confirm(`Check out ${s.guest_name} from room ${s.room} and make the invoice? The bill is then closed.`)) void run(async () => { await apiPost(`${API}/stays/${stayId}/checkout`, {}); }, 'Checked out. The invoice is ready.'); }}>
            Check out and make the invoice
          </button>
        </section>
      )}
      {!open && d.invoice && (
        <section className={`mt-4 ${ns.card}`}>
          <a className={ns.primary} href={`/padharosaa/billing/invoice/${stayId}`} target="_blank" rel="noopener noreferrer">Open invoice {d.invoice.number} to print</a>
        </section>
      )}
    </div>
  );
}

/** Correct one line of the open bill by hand: the GST, the price, the quantity (and the words of a charge added at the desk), or take a dish off. */
function LineEdit({ line, setup, busy, saveItem, saveLine }: { line: FolioResponse['folio']['lines'][number]; setup: BillingSetup; busy: boolean; saveItem: (b: object) => void; saveLine: (b: object) => void }) {
  const isOrder = line.src === 'order';
  const [desc, setDesc] = useState(line.description);
  const [qty, setQty] = useState(String(line.qty));
  const [price, setPrice] = useState(line.unit_paise !== null ? String(Math.abs(line.unit_paise) / 100) : '');
  const neg = (line.unit_paise ?? 0) < 0;
  const [tax, setTax] = useState(isOrder ? 'auto' : 'kind'); // auto / kind = as set up; otherwise a rate in basis points ('0' = none)
  const [reason, setReason] = useState('');
  const paise = parseRupeesToPaise(price);
  const ok = paise !== null && (isOrder ? paise >= 0 : paise > 0) && /^\d{1,2}$/.test(qty) && Number(qty) >= 1 && (isOrder || desc.trim().length > 0);
  const rates = setup.tax_rates.filter((t) => t.active && t.rate_bp > 0);
  const select = (
    <Label text="GST on this line"><select aria-label="GST on this line" className={field} value={tax} onChange={(e) => setTax(e.target.value)}>
      <option value={isOrder ? 'auto' : 'kind'}>{isOrder ? 'As set up (your GST rules)' : 'As set up for this kind of charge'}</option>
      <option value="0">No GST</option>
      {rates.map((t) => <option key={t.id} value={t.rate_bp}>{t.name}</option>)}
    </select></Label>
  );
  return (
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => {
      e.preventDefault();
      if (!ok) return;
      if (isOrder) saveItem({ tax_bp: tax === 'auto' ? null : Number(tax), unit_paise: paise, qty: Number(qty), removed: false });
      else saveLine({ description: desc.trim(), qty: Number(qty), unit_paise: (neg ? -1 : 1) * paise!, tax_bp: tax === 'kind' ? -1 : Number(tax) });
    }}>
      {!isOrder && <div className="sm:col-span-4"><Label text="What for"><input className={field} value={desc} maxLength={120} onChange={(e) => setDesc(e.target.value)} /></Label></div>}
      <Label text="How many"><input className={field} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Label>
      <Label text="Price of one, in ₹"><input className={field} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Label>
      <div className="sm:col-span-2">{select}</div>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-4">
        <button type="submit" className={ns.primary} disabled={busy || !ok}>Save this line</button>
        {isOrder && <>
          <button type="button" className={ns.secondary} disabled={busy} onClick={() => saveItem({ tax_bp: null, unit_paise: null, qty: null, removed: false })}>Back as ordered</button>
          <Label text="Take this dish off the bill. Why?"><input className={`${field} !mt-1 w-64`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Label>
          <button type="button" className={ns.danger} disabled={busy || !reason.trim()} onClick={() => saveItem({ removed: true, reason: reason.trim() })}>Take it off</button>
        </>}
      </div>
    </form>
  );
}

function OrderRow({ label, amount, busy, onCross }: { label: string; amount: number; busy: boolean; onCross: (reason: string) => void }) {
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="flex items-center gap-3"><span className="tabular-nums">{rupees2(amount)}</span>
          <button type="button" className="text-sm font-semibold text-red-800 underline" onClick={() => setAsk(!ask)}>Cross out</button></span>
      </div>
      {ask && (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onCross(reason.trim()); }}>
          <Label text="Why? (the guest did not get it, ordered by mistake...)"><input className={`${field} !mt-1 w-72`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Label>
          <button type="submit" className={ns.danger} disabled={busy || !reason.trim()}>Cross out this order</button>
        </form>
      )}
    </li>
  );
}

function VoidRow({ line, busy, onVoid }: { line: { id: string; description: string; qty: number; unit_paise: number }; busy: boolean; onVoid: (reason: string) => void }) {
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span>{line.description}{line.qty > 1 ? ` × ${line.qty}` : ''}</span>
        <span className="flex items-center gap-3"><span className="tabular-nums">{rupees2(line.qty * line.unit_paise)}</span>
          <button type="button" className="text-sm font-semibold text-red-800 underline" onClick={() => setAsk(!ask)}>Cross out</button></span>
      </div>
      {ask && (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onVoid(reason.trim()); }}>
          <Label text="Why?"><input className={`${field} !mt-1 w-64`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Label>
          <button type="submit" className={ns.danger} disabled={busy || !reason.trim()}>Cross out this charge</button>
        </form>
      )}
    </li>
  );
}

function ChargeForm({ setup, busy, save }: { setup: BillingSetup; busy: boolean; save: (b: unknown) => void }) {
  const cats = setup.categories.filter((c) => c.active && c.kind !== 'room');
  const [category, setCategory] = useState(cats.find((c) => c.kind === 'other')?.id ?? cats[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('1');
  const [amount, setAmount] = useState('');
  const neg = amount.trim().startsWith('-');
  const paise = parseRupeesToPaise(amount.replace(/^-/, ''));
  const ok = category && description.trim() && paise !== null && paise > 0 && /^\d{1,2}$/.test(qty) && Number(qty) >= 1;
  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (ok) save({ category, description: description.trim(), qty: Number(qty), unit_paise: (neg ? -1 : 1) * paise! }); }}>
      <Label text="Type of charge"><select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Label>
      <Label text="What for"><input className={field} value={description} maxLength={120} onChange={(e) => setDescription(e.target.value)} placeholder="Laundry, 5 shirts" /></Label>
      <Label text="How many"><input className={field} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Label>
      <Label text="Price of one, in ₹" hint="Type a minus (like -500) for a discount."><input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Label>
      <div className="sm:col-span-2"><button type="submit" className={ns.primary} disabled={busy || !ok}>Add to the bill</button></div>
    </form>
  );
}

function PayForm({ balance, busy, save }: { balance: number; busy: boolean; save: (b: unknown) => void }) {
  const [kind, setKind] = useState<'payment' | 'refund'>('payment');
  const [mode, setMode] = useState('cash');
  const [amount, setAmount] = useState(balance > 0 ? (balance / 100).toFixed(2).replace(/\.00$/, '') : '');
  const [ref, setRef] = useState('');
  const paise = parseRupeesToPaise(amount);
  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (paise) save({ kind, mode, amount_paise: paise, ref: ref.trim() || null }); }}>
      <Label text="What happened"><select className={field} value={kind} onChange={(e) => setKind(e.target.value as 'payment' | 'refund')}><option value="payment">Guest paid</option><option value="refund">Money given back to the guest</option></select></Label>
      <Label text="How"><select className={field} value={mode} onChange={(e) => setMode(e.target.value)}>{PAY_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Label>
      <Label text="Amount in ₹"><input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Label>
      <Label text="Reference (optional)" hint="Receipt number, UPI reference..."><input className={field} value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} /></Label>
      <div className="sm:col-span-2"><button type="submit" className={ns.primary} disabled={busy || !paise}>Save payment</button></div>
    </form>
  );
}

function EditStay({ rate, outOn, busy, save }: { rate: number; outOn: string; busy: boolean; save: (b: unknown) => void }) {
  const [r, setR] = useState((rate / 100).toString());
  const [o, setO] = useState(outOn);
  const paise = parseRupeesToPaise(r);
  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (paise !== null) save({ rate_paise: paise, out_on: o }); }}>
      <Label text="Rate per night in ₹"><input className={field} inputMode="decimal" value={r} onChange={(e) => setR(e.target.value)} /></Label>
      <Label text="Leaving on (check-out day)"><input className={field} type="date" value={o} onChange={(e) => setO(e.target.value)} /></Label>
      <div className="sm:col-span-2"><button type="submit" className={ns.primary} disabled={busy || paise === null || !o}>Save</button></div>
    </form>
  );
}
