'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ns } from '@/components/ui/ns';
import { Label, errText, field, small, td, th } from '@/components/billing/common';
import { PAY_MODES, parsePercent, payModeLabel, rupees2, type StayRow } from '@/lib/padharosaa/billing';
import { parseRupeesToPaise } from '@/lib/money';
import { ruleBp, splitBill, type TaxRule } from '@/lib/padharosaa/posmath';

const API = '/api/padharosaa/v1/staff';
interface MenuItem { id: string; name: string; price_paise: number; diet: string; available: boolean }
interface Menu { tax_bp: number; rules: TaxRule[]; tax_rates: { id: string; name: string; rate_bp: number }[]; categories: { id: string; name: string; items: MenuItem[] }[] }
interface BillRow { id: string; number: string; label: string | null; customer: string | null; total_paise: number; pay_mode: string; status: string; created_at: string; guest: string | null; room: string | null }
interface Bill { number: string; at: string; label: string | null; customer: string | null; lines: { name: string; qty: number; unit_paise: number; amount_paise: number; tax_bp?: number }[]; subtotal_paise: number; discount_paise: number; service_bp: number; service_paise: number; tax_bp: number; tax_paise: number; tax_groups: { tax_bp: number; taxable_paise: number; tax_paise: number }[]; round_paise: number; total_paise: number; pay_mode: string; status: string; void_reason: string | null; room: string | null; guest: string | null; hotel: { name: string; legal_name: string | null; gstin: string | null; address: string | null } }
type CartLine = { key: string; item?: string; name: string; unit: number; qty: number };
const DIET: Record<string, string> = { veg: 'bg-emerald-600', nonveg: 'bg-red-600', egg: 'bg-amber-500', jain: 'bg-lime-600' };

/** Counter billing: pick dishes, add anything else, take the payment (or put it on a guest's room bill), print the bill. */
export function PosApp({ role }: { role: string }) {
  const boss = role === 'owner' || role === 'manager';
  const [tab, setTab] = useState<'sell' | 'bills'>('sell');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [label, setLabel] = useState('');
  const [customer, setCustomer] = useState('');
  const [mode, setMode] = useState('cash');
  const [stay, setStay] = useState('');
  const [guests, setGuests] = useState<StayRow[]>([]);
  const [custom, setCustom] = useState({ name: '', price: '' });
  const [tax, setTax] = useState('default'); // 'default' = each dish by the hotel's GST rules, 'none', or one rate in basis points for the whole bill
  const [servicePct, setServicePct] = useState('');
  const [discount, setDiscount] = useState('');
  const [kot, setKot] = useState<{ lines: { name: string; qty: number }[]; label: string; at: Date } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [bill, setBill] = useState<Bill | null>(null);
  const [rows, setRows] = useState<BillRow[] | null>(null);
  const flash = useCallback((ok: boolean, text: string) => { setMsg({ ok, text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  useEffect(() => {
    void (async () => {
      try { setMenu(await apiGet<Menu>(`${API}/pos/menu`)); } catch (e) { flash(false, errText(e, 'The menu could not be loaded.')); }
      try { setGuests((await apiGet<{ stays: StayRow[] }>(`${API}/stays?status=in_house`)).stays); } catch { /* room billing is optional */ }
    })();
  }, [flash]);
  const loadBills = useCallback(async () => { try { setRows((await apiGet<{ bills: BillRow[] }>(`${API}/pos/list`)).bills); } catch (e) { flash(false, errText(e)); } }, [flash]);
  useEffect(() => { if (tab === 'bills') void loadBills(); }, [tab, loadBills]);

  const sub = cart.reduce((a, l) => a + l.unit * l.qty, 0);
  const discPaise = discount.trim() ? parseRupeesToPaise(discount) : 0;
  const serviceBp = servicePct.trim() ? parsePercent(servicePct) : 0;
  const sectionOf = useMemo(() => { const m = new Map<string, string>(); for (const c of menu?.categories ?? []) for (const i of c.items) m.set(i.id, c.name); return m; }, [menu]);
  const lineBp = (l: CartLine) => (tax === 'none' ? 0 : tax !== 'default' ? Number(tax) : ruleBp(menu?.rules ?? [], l.name, l.item ? sectionOf.get(l.item) : null) ?? menu?.tax_bp ?? 0);
  const inputsOk = discPaise !== null && discPaise < Math.max(sub, 1) && serviceBp !== null && serviceBp <= 3000;
  const split = splitBill(cart.map((l) => ({ amount: l.unit * l.qty, bp: lineBp(l) })), inputsOk ? discPaise ?? 0 : 0, inputsOk ? serviceBp ?? 0 : 0);
  const net = Math.max(0, sub - (discPaise ?? 0));
  const servicePaise = split.service;
  const add = (l: Omit<CartLine, 'qty' | 'key'>) => setCart((c) => { const i = c.findIndex((x) => x.item && x.item === l.item); if (i >= 0) return c.map((x, j) => (j === i ? { ...x, qty: Math.min(99, x.qty + 1) } : x)); return [...c, { ...l, qty: 1, key: `${Date.now()}${c.length}` }]; });
  const bump = (key: string, d: number) => setCart((c) => c.map((x) => (x.key === key ? { ...x, qty: x.qty + d } : x)).filter((x) => x.qty > 0));
  const items = useMemo(() => (menu?.categories ?? []).filter((c) => !cat || c.id === cat).flatMap((c) => c.items).filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())), [menu, cat, q]);

  const addCustom = () => { const p = parseRupeesToPaise(custom.price); if (custom.name.trim() && p) { add({ name: custom.name.trim(), unit: p }); setCustom({ name: '', price: '' }); } };
  const pay = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ id: string; number: string }>(`${API}/pos/create`, { lines: cart.map((l) => (l.item ? { item: l.item, qty: l.qty } : { name: l.name, qty: l.qty, unit_paise: l.unit })), label: label.trim() || null, customer: customer.trim() || null, mode, stay: mode === 'room' ? stay : null,
        tax_bp: tax === 'default' ? null : tax === 'none' ? 0 : Number(tax), service_bp: serviceBp ?? 0, discount_paise: discPaise ?? 0 });
      setBill(await apiGet<Bill>(`${API}/pos/bill?id=${r.id}`));
      setCart([]); setLabel(''); setCustomer(''); setStay(''); setMode('cash'); setMsg(null); setDiscount(''); setServicePct(''); setTax('default');
    } catch (e) { flash(false, errText(e, 'The bill could not be made. Please check it and try again.')); }
    setBusy(false);
  };
  const show = async (id: string) => { try { setBill(await apiGet<Bill>(`${API}/pos/bill?id=${id}`)); } catch (e) { flash(false, errText(e)); } };
  const voidBill = async (r: BillRow) => {
    const reason = window.prompt(`Cancel bill ${r.number}? Why?`);
    if (!reason?.trim()) return;
    try { await apiPost(`${API}/pos/void`, { id: r.id, reason: reason.trim() }); flash(true, 'Bill cancelled.'); void loadBills(); } catch (e) { flash(false, errText(e, 'That bill could not be cancelled. A bill on a room that has checked out stays.')); }
  };

  if (bill) return <Receipt bill={bill} onClose={() => setBill(null)} />;
  if (kot) return <KotSlip kot={kot} onClose={() => setKot(null)} />;
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-3 text-stone-900">
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mb-3 rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{msg.text}</p>}
      <div role="tablist" aria-label="Counter billing" className="-mx-4 flex gap-6 overflow-x-auto border-b border-stone-200 px-4">
        {([['sell', 'New bill'], ['bills', "Today's bills"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px min-h-11 shrink-0 border-b-2 px-0.5 text-sm font-semibold ${tab === k ? 'border-indigo-900 text-indigo-900' : 'border-transparent text-stone-500'}`}>{l}</button>)}
      </div>
      {tab === 'bills' ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="border-b border-stone-200 bg-stone-50"><tr><th className={th}>Bill</th><th className={th}>For</th><th className={th}>Paid by</th><th className={`${th} text-right`}>Amount</th><th className={th} /></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows?.map((r) => (
                <tr key={r.id} data-testid="pos-row" className={r.status === 'void' ? 'opacity-50' : ''}>
                  <td className={td}><span className="font-semibold">{r.number}</span><span className="block text-xs text-stone-500">{new Date(r.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}{r.status === 'void' ? ' · cancelled' : ''}</span></td>
                  <td className={td}>{r.room ? `Room ${r.room} · ${r.guest}` : r.label ?? r.customer ?? '—'}</td>
                  <td className={td}>{r.pay_mode === 'room' ? 'On room bill' : payModeLabel(r.pay_mode)}</td>
                  <td className={`${td} text-right font-semibold`}>{rupees2(r.total_paise)}</td>
                  <td className={`${td} text-right`}><span className="flex justify-end gap-1.5"><button type="button" className={small} onClick={() => void show(r.id)}>Open</button>{boss && r.status === 'paid' && <button type="button" className={small} onClick={() => void voidBill(r)}>Cancel</button>}</span></td>
                </tr>
              ))}
              {rows && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-stone-600">No bills yet today.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Menu" className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" aria-label="Search dishes" placeholder="Search dishes" value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11 w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3 text-sm" />
              <div className="flex gap-2 overflow-x-auto">
                <button type="button" aria-pressed={!cat} onClick={() => setCat(null)} className={`min-h-9 shrink-0 rounded-lg border px-3 text-sm font-semibold ${!cat ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white'}`}>All</button>
                {menu?.categories.map((c) => <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)} className={`min-h-9 shrink-0 rounded-lg border px-3 text-sm font-semibold ${cat === c.id ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white'}`}>{c.name}</button>)}
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-stone-200 bg-white p-3">
              <p className={ns.label}>Something not on the menu</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input aria-label="Item name" placeholder="Name" value={custom.name} maxLength={80} onChange={(e) => setCustom({ ...custom, name: e.target.value })} className="min-h-11 flex-1 rounded-lg border border-stone-300 px-3 text-sm" />
                <input aria-label="Price in ₹" placeholder="Price ₹" inputMode="decimal" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} className="min-h-11 w-28 rounded-lg border border-stone-300 px-3 text-sm" />
                <button type="button" className={ns.secondary} onClick={addCustom}>Add</button>
              </div>
            </div>
            <div className="mt-3 max-h-[60vh] overflow-y-auto pr-1 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="pos-dishes">
              {items.map((i) => (
                <button key={i.id} type="button" onClick={() => add({ item: i.id, name: i.name, unit: i.price_paise })} className={`min-h-20 rounded-xl border border-stone-200 bg-white p-3 text-left hover:border-indigo-400 ${i.available ? '' : 'opacity-60'}`}>
                  <span className="flex items-start gap-1.5"><i aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DIET[i.diet] ?? 'bg-stone-400'}`} /><span className="text-sm font-semibold leading-snug">{i.name}</span></span>
                  <span className="mt-1 block text-sm text-stone-600">{rupees2(i.price_paise)}{!i.available && ' · sold out'}</span>
                </button>
              ))}
              {menu && items.length === 0 && <p className="col-span-full text-sm text-stone-600">No dishes here. The menu is set by Taprizz; you can still add anything below.</p>}
            </div>
          </section>
          <aside className={`${ns.card} h-fit lg:sticky lg:top-20`} aria-label="Bill">
            <h2 className="text-base font-semibold tracking-tight">Bill</h2>
            <ul className="mt-2 divide-y divide-stone-100" data-testid="pos-cart">
              {cart.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.name}<span className="ml-1.5 text-xs text-stone-500">{lineBp(l) === 0 ? 'no GST' : `GST ${lineBp(l) / 100}%`}</span></span>
                  <span className="flex items-center gap-1"><button type="button" aria-label={`Less ${l.name}`} className={small} onClick={() => bump(l.key, -1)}>−</button><b className="w-6 text-center">{l.qty}</b><button type="button" aria-label={`More ${l.name}`} className={small} onClick={() => bump(l.key, 1)}>+</button></span>
                  <span className="w-20 text-right font-semibold">{rupees2(l.unit * l.qty)}</span>
                </li>
              ))}
              {cart.length === 0 && <li className="py-3 text-sm text-stone-600">Tap a dish to add it.</li>}
            </ul>
            <dl className="mt-3 space-y-1 text-sm" data-testid="pos-totals">
              <div className="flex justify-between"><dt>Items</dt><dd>{rupees2(sub)}</dd></div>
              {(discPaise ?? 0) > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>− {rupees2(discPaise ?? 0)}</dd></div>}
              {servicePaise > 0 && <div className="flex justify-between"><dt>Service charge {servicePct}%</dt><dd>{rupees2(servicePaise)}</dd></div>}
              {split.groups.filter((g) => g.tax_paise > 0).map((g) => <div key={g.tax_bp} className="flex justify-between"><dt>CGST {g.tax_bp / 200}% + SGST {g.tax_bp / 200}%</dt><dd>{rupees2(g.tax_paise)}</dd></div>)}
              <div className="flex justify-between border-t border-stone-200 pt-1 text-base font-semibold"><dt>To pay</dt><dd>{rupees2(net + servicePaise + split.tax)}</dd></div>
              <p className="text-xs text-stone-500">Rounded to the rupee on the bill if your hotel does that.</p>
            </dl>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <Label text="GST on this bill"><select aria-label="GST on this bill" className={field} value={tax} onChange={(e) => setTax(e.target.value)}><option value="default">{menu && menu.tax_bp > 0 ? `Automatic (each item by your GST rules, usually ${menu.tax_bp / 100}%)` : 'Automatic (each item by your GST rules)'}</option>{menu?.tax_rates.map((t) => <option key={t.id} value={t.rate_bp}>{t.name}</option>)}<option value="none">No GST on this bill</option></select></Label>
              <Label text="Service charge %" hint="Optional"><input className={field} inputMode="decimal" value={servicePct} onChange={(e) => setServicePct(e.target.value)} /></Label>
              <Label text="Discount in ₹" hint="Optional, off the items"><input className={field} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Label>
            </div>
            <div className="mt-3 grid gap-3">
              <Label text="Table or note"><input className={field} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} /></Label>
              <Label text="Customer name (optional)"><input className={field} value={customer} maxLength={80} onChange={(e) => setCustomer(e.target.value)} /></Label>
              <Label text="Paid by"><select aria-label="Paid by" className={field} value={mode} onChange={(e) => setMode(e.target.value)}>{PAY_MODES.filter(([k]) => k !== 'company').map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="room" disabled={guests.length === 0}>Put on a room bill</option></select></Label>
              {mode === 'room' && <Label text="Room"><select aria-label="Room bill" className={field} value={stay} onChange={(e) => setStay(e.target.value)}><option value="">Choose the guest…</option>{guests.map((g) => <option key={g.id} value={g.id}>Room {g.room} · {g.guest_name}</option>)}</select></Label>}
            </div>
            <div className="mt-4 grid gap-2">
              <button type="button" className={`${ns.primary} w-full`} disabled={busy || cart.length === 0 || (mode === 'room' && !stay) || !inputsOk} onClick={() => void pay()}>{busy ? 'Making the bill…' : 'Make the bill'}</button>
              <button type="button" className={`${ns.secondary} w-full`} disabled={cart.length === 0} onClick={() => setKot({ lines: cart.map((l) => ({ name: l.name, qty: l.qty })), label: label.trim(), at: new Date() })}>Print KOT for the kitchen</button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Receipt({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-4 text-stone-900">
      <ThermalPage />
      <div className="mb-3 flex gap-2 print:hidden"><button type="button" className={ns.primary} onClick={() => window.print()}>Print the bill (roll)</button><button type="button" className={ns.secondary} onClick={onClose}>Back to billing</button></div>
      <article className="thermal rounded-xl border border-stone-300 bg-white p-5 text-sm" data-testid="receipt">
        <header className="text-center">
          <p className="text-lg font-semibold">{bill.hotel.legal_name ?? bill.hotel.name}</p>
          {bill.hotel.address && <p className="text-xs text-stone-600">{bill.hotel.address}</p>}
          {bill.hotel.gstin && <p className="text-xs">GSTIN {bill.hotel.gstin}</p>}
        </header>
        <p className="mt-3 flex justify-between"><b data-testid="receipt-number">{bill.number}</b><span>{new Date(bill.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></p>
        {(bill.label || bill.customer || bill.room) && <p className="text-xs text-stone-600">{[bill.room && `Room ${bill.room} · ${bill.guest}`, bill.label, bill.customer].filter(Boolean).join(' · ')}</p>}
        {bill.status === 'void' && <p className="mt-2 rounded bg-red-50 p-2 font-semibold text-red-900">CANCELLED{bill.void_reason ? `: ${bill.void_reason}` : ''}</p>}
        <table className="mt-3 w-full"><tbody className="divide-y divide-stone-100">
          {bill.lines.map((l, i) => <tr key={i}><td className="py-1.5">{l.name}<span className="block text-xs text-stone-500">{l.qty} × {rupees2(l.unit_paise)}</span></td><td className="py-1.5 text-right">{rupees2(l.amount_paise)}</td></tr>)}
        </tbody></table>
        <dl className="mt-3 space-y-1 border-t border-stone-300 pt-2">
          <div className="flex justify-between"><dt>Items</dt><dd>{rupees2(bill.subtotal_paise)}</dd></div>
          {bill.discount_paise > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>− {rupees2(bill.discount_paise)}</dd></div>}
          {bill.service_paise > 0 && <div className="flex justify-between"><dt>Service charge {bill.service_bp / 100}%</dt><dd>{rupees2(bill.service_paise)}</dd></div>}
          {bill.tax_groups.filter((g) => g.tax_paise > 0).map((g) => <div key={g.tax_bp} className="flex justify-between"><dt>CGST {g.tax_bp / 200}% + SGST {g.tax_bp / 200}% on {rupees2(g.taxable_paise)}</dt><dd>{rupees2(g.tax_paise)}</dd></div>)}
          {bill.round_paise !== 0 && <div className="flex justify-between"><dt>Round off</dt><dd>{rupees2(bill.round_paise)}</dd></div>}
          <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd data-testid="receipt-total">{rupees2(bill.total_paise)}</dd></div>
          <div className="flex justify-between text-xs text-stone-600"><dt>Paid by</dt><dd>{bill.pay_mode === 'room' ? 'Put on the room bill' : payModeLabel(bill.pay_mode)}</dd></div>
        </dl>
        <p className="mt-4 text-center text-xs text-stone-500">Thank you. Please visit again.</p>
      </article>
    </div>
  );
}

/** While a roll slip is on the screen, the printer gets a narrow page (80 mm, like the machine at the counter) and nothing else. */
function ThermalPage() {
  return <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } body { background: #fff !important; } .thermal { border: 0 !important; box-shadow: none !important; padding: 0 !important; font-size: 11px !important; width: 100% !important; } }`}</style>;
}

/** The slip for the kitchen: what to cook, for which table, and when. No prices. */
function KotSlip({ kot, onClose }: { kot: { lines: { name: string; qty: number }[]; label: string; at: Date }; onClose: () => void }) {
  return (
    <div className="mx-auto max-w-sm px-4 pb-24 pt-4 text-stone-900">
      <ThermalPage />
      <div className="mb-3 flex gap-2 print:hidden"><button type="button" className={ns.primary} onClick={() => window.print()}>Print KOT (roll)</button><button type="button" className={ns.secondary} onClick={onClose}>Back to billing</button></div>
      <article className="thermal rounded-xl border border-stone-300 bg-white p-5 text-sm" data-testid="kot">
        <p className="text-center text-lg font-bold tracking-wide">KOT</p>
        <p className="mt-1 flex justify-between text-xs"><b>{kot.label || 'Counter'}</b><span>{kot.at.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></p>
        <ul className="mt-3 divide-y divide-dashed divide-stone-400 text-base">
          {kot.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 py-1.5"><span>{l.name}</span><b>× {l.qty}</b></li>)}
        </ul>
      </article>
    </div>
  );
}
