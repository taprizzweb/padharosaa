'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { Stat, ns } from '@/components/ui/ns';
import { Label, errText, field, small, td, th } from '@/components/billing/common';
import { ApiFailure } from '@/lib/guest/client';
import { rupees2 } from '@/lib/padharosaa/billing';
import { parseRupeesToPaise } from '@/lib/money';

const API = '/api/padharosaa/v1/staff/inventory';
interface Item { id: string; name: string; unit: string; category: string | null; min_qty: number; active: boolean; stock: number; low: boolean; last_at: string | null; used_30: number; spent_30: number }
interface Move { id: string; kind: 'in' | 'out' | 'waste' | 'adjust'; delta: number; cost_paise: number | null; note: string | null; at: string; by: string | null }
type Kind = Move['kind'];
const KIND_LABEL: Record<Kind, string> = { in: 'Stock added', out: 'Used', waste: 'Spoiled', adjust: 'Counted' };
const num = (n: number): string => String(Math.round(n * 1000) / 1000);
const STAMP: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' };
/** "28 Oct 2026, 9:15 pm": when the stock was last touched */
const stamp = (iso: string): string => new Date(iso).toLocaleString('en-IN', STAMP);
const dayOf = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/** Stock of supplies: what is on the shelf, what is running low, what was used or wasted, and what was bought. */
export function InventoryApp({ role }: { role: string }) {
  const boss = role === 'owner' || role === 'manager';
  const [items, setItems] = useState<Item[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [act, setAct] = useState<{ item: Item; kind: Kind } | null>(null);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [log, setLog] = useState<{ item: Item; moves: Move[] } | null>(null);
  const flash = useCallback((ok: boolean, text: string) => { setMsg({ ok, text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const load = useCallback(async () => { try { setItems((await apiGet<{ items: Item[] }>(`${API}/list`)).items); } catch (e) { flash(false, errText(e, 'The stock could not be loaded.')); } }, [flash]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (items ?? []).filter((i) => (!onlyLow || i.low) && (!q.trim() || `${i.name} ${i.category ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))), [items, q, onlyLow]);
  const low = (items ?? []).filter((i) => i.low).length;
  const spent = (items ?? []).reduce((a, i) => a + (i.spent_30 || 0), 0);
  const open = async (item: Item) => { try { setLog({ item, moves: (await apiGet<{ moves: Move[] }>(`${API}/moves?item=${item.id}`)).moves }); } catch (e) { flash(false, errText(e)); } };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-3 text-stone-900">
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mb-3 rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{msg.text}</p>}
      {items && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="inv-summary">
          <Stat label="Items" value={items.filter((i) => i.active).length} />
          <Stat label="Running low" value={low} tone={low ? 'warn' : 'good'} sub={low ? 'at or under the level you set' : 'all above the level'} />
          <Stat label="Bought, last 30 days" value={rupees2(spent)} />
        </div>
      )}
      {items && items.length > 0 && !act && !edit && !log && <p className="mt-3 text-sm text-stone-600">Add stock when something comes in. Press Use when the kitchen or housekeeping takes some. Spoiled is for what is thrown away. If the shelf count is different, use Set exact count.</p>}
      {act ? <MovePanel item={act.item} kind={act.kind} flash={flash} onClose={() => setAct(null)} onDone={() => { setAct(null); void load(); }} />
        : edit ? <ItemForm item={edit === 'new' ? null : edit} flash={flash} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void load(); }} />
        : log ? (
          <section className={`mt-4 ${ns.card}`} aria-label="History">
            <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold tracking-tight">{log.item.name}: last movements</h2><button type="button" className={ns.secondary} onClick={() => setLog(null)}>Back</button></div>
            <ul className="mt-3 divide-y divide-stone-100 text-sm" data-testid="inv-log">
              {log.moves.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span><b>{KIND_LABEL[m.kind]}</b> {m.delta > 0 ? '+' : ''}{num(m.delta)} {log.item.unit}{m.cost_paise ? ` · ${rupees2(m.cost_paise)}` : ''}{m.note ? ` · ${m.note}` : ''}</span>
                  <span className="text-xs text-stone-500">{stamp(m.at)}{m.by ? ` · ${m.by}` : ''}</span>
                </li>
              ))}
              {log.moves.length === 0 && <li className="py-3 text-stone-600">Nothing recorded yet.</li>}
            </ul>
          </section>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input type="search" aria-label="Search items" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11 w-full max-w-xs rounded-lg border border-stone-300 bg-white px-3 text-sm" />
              <button type="button" aria-pressed={onlyLow} onClick={() => setOnlyLow((v) => !v)} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${onlyLow ? 'border-red-700 bg-red-700 text-white' : 'border-stone-300 bg-white'}`}>Running low only</button>
              {boss && <button type="button" className={`${ns.primary} ml-auto`} onClick={() => setEdit('new')}>Add an item</button>}
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-stone-200 bg-stone-50"><tr><th className={th}>Item</th><th className={`${th} text-right`}>In stock</th><th className={`${th} text-right`}>Used, 30 days</th><th className={th}>Last updated</th><th className={th} /></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {shown.map((i) => (
                    <tr key={i.id} data-testid="inv-row" className={!i.active ? 'opacity-50' : ''}>
                      <td className={td}><span className="font-semibold">{i.name}</span>{i.category && <span className="block text-xs text-stone-500">{i.category}</span>}</td>
                      <td className={`${td} text-right`}><span className={`font-semibold ${i.low ? 'text-red-800' : ''}`}>{num(i.stock)} {i.unit}</span>{i.low && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-900">Low</span>}{i.min_qty > 0 && <span className="block text-xs text-stone-500">level {num(i.min_qty)}</span>}</td>
                      <td className={`${td} text-right`}>{num(i.used_30)} {i.unit}</td>
                      <td className={`${td} text-xs text-stone-600`} data-testid="inv-updated">{i.last_at ? <>{stamp(i.last_at)}{dayOf(i.last_at) === dayOf(new Date().toISOString()) && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-900">Today</span>}</> : <span className="text-stone-400">Nothing yet</span>}</td>
                      <td className={`${td} text-right`}>
                        {i.active && <span className="flex flex-wrap justify-end gap-1.5">
                          <button type="button" className={small} onClick={() => setAct({ item: i, kind: 'out' })}>Use</button>
                          <button type="button" className={small} onClick={() => setAct({ item: i, kind: 'waste' })}>Spoiled</button>
                          {boss && <button type="button" className={small} onClick={() => setAct({ item: i, kind: 'in' })}>Add stock</button>}
                          {boss && <button type="button" className={small} onClick={() => setAct({ item: i, kind: 'adjust' })}>Set exact count</button>}
                        </span>}
                        <span className="mt-1 flex justify-end gap-3 text-xs font-semibold"><button type="button" className="underline" onClick={() => void open(i)}>History</button>{boss && <button type="button" className="underline" onClick={() => setEdit(i)}>Edit</button>}</span>
                      </td>
                    </tr>
                  ))}
                  {items && shown.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-stone-600">{items.length === 0 ? (boss ? 'No items yet. Press Add an item and add rice, oil, towels, soap… anything you want to keep count of. Example: Rice · counted in kg · warn me below 10.' : 'No items yet. The owner or manager adds them.') : 'Nothing matches.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
    </div>
  );
}

function MovePanel({ item, kind, flash, onClose, onDone }: { item: Item; kind: Kind; flash: Flash2; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = qty.trim() === '' ? NaN : Number(qty);
  const costPaise = cost.trim() ? parseRupeesToPaise(cost) : null;
  const ok = Number.isFinite(n) && n >= 0 && (kind === 'adjust' || n > 0) && Math.round(n * 1000) / 1000 === n && (kind !== 'in' || cost.trim() === '' || costPaise !== null);
  const go = async () => {
    setBusy(true);
    try {
      await apiPost(`${API}/move`, { item: item.id, kind, qty: n, cost_paise: kind === 'in' ? costPaise : null, note: note.trim() || null });
      flash(true, `${item.name}: ${KIND_LABEL[kind].toLowerCase()} saved.`); onDone();
    } catch (e) { flash(false, e instanceof ApiFailure && e.status === 409 ? `Only ${num(item.stock)} ${item.unit} is in stock. Please check the number.` : errText(e)); }
    setBusy(false);
  };
  return (
    <form className={`mt-4 ${ns.card}`} onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void go(); }}>
      <h2 className="text-base font-semibold tracking-tight">{item.name}: {KIND_LABEL[kind].toLowerCase()}</h2>
      <p className="mt-1 text-sm text-stone-600">In stock now: {num(item.stock)} {item.unit}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Label text={kind === 'adjust' ? `Counted on the shelf (${item.unit})` : `How much (${item.unit})`}><input className={field} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Label>
        {kind === 'in' && <Label text="Total cost in ₹" hint="Optional."><input className={field} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Label>}
        <Label text={kind === 'in' ? 'Supplier or note' : 'Note'}><input className={field} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} /></Label>
      </div>
      <div className="mt-4 flex gap-2"><button type="submit" className={ns.primary} disabled={!ok || busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className={ns.secondary} onClick={onClose}>Back</button></div>
    </form>
  );
}
type Flash2 = (ok: boolean, text: string) => void;

function ItemForm({ item, flash, onClose, onDone }: { item: Item | null; flash: Flash2; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: item?.name ?? '', unit: item?.unit ?? 'kg', category: item?.category ?? '', min: String(item?.min_qty ?? 0), active: item?.active ?? true });
  const [busy, setBusy] = useState(false);
  const min = Number(f.min);
  const ok = f.name.trim().length > 0 && f.unit.trim().length > 0 && Number.isFinite(min) && min >= 0;
  const go = async () => {
    setBusy(true);
    try { await apiPost(`${API}/item`, { id: item?.id ?? null, name: f.name.trim(), unit: f.unit.trim(), category: f.category.trim() || null, min_qty: min, active: f.active }); flash(true, `${f.name.trim()} saved.`); onDone(); }
    catch (e) { flash(false, e instanceof ApiFailure && e.status === 409 ? 'An item with that name already exists.' : errText(e)); }
    setBusy(false);
  };
  return (
    <form className={`mt-4 ${ns.card}`} onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void go(); }}>
      <h2 className="text-base font-semibold tracking-tight">{item ? `Edit ${item.name}` : 'Add an item'}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Label text="Name"><input className={field} value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} /></Label>
        <Label text="Counted in" hint="kg, ltr, pcs, packet…"><input className={field} value={f.unit} maxLength={12} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Label>
        <Label text="Group" hint="Optional: Dry goods, Linen, Toiletries…"><input className={field} value={f.category} maxLength={40} onChange={(e) => setF({ ...f, category: e.target.value })} /></Label>
        <Label text="Warn me when stock is below" hint="Example: 10. Leave 0 for no warning."><input className={field} inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Label>
      </div>
      {item && <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Still in use</label>}
      <div className="mt-4 flex gap-2"><button type="submit" className={ns.primary} disabled={!ok || busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className={ns.secondary} onClick={onClose}>Back</button></div>
    </form>
  );
}
