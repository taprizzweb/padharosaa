'use client';
import { useEffect, useState } from 'react';
import { Alert, Notice, Sheet, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { errText, inputCls } from '@/components/dash/api';
import { paiseToRupees, rupeesToPaise } from '@/lib/billing';
import { formatPaise } from '@/lib/money';
import { adminGet, adminPost, type Plan } from './AdminApi';

const smallBtn = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50';
const empty = { id: null as string | null, name: '', points: '', setup: '', monthly: '', yearly: '', active: true, sort: '0' };

/** The plans you sell: name, bullet points and prices. Nothing here is fixed in the code. */
export function PlansManager() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<typeof empty | null>(null);
  const [del, setDel] = useState<Plan | null>(null);

  const load = async () => {
    try {
      setPlans((await adminGet<{ plans: Plan[] }>('plans')).plans);
      setError(null);
    } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { void load(); }, []);

  const run = async <T,>(fn: () => Promise<T>, ok: string): Promise<T | null> => {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await fn(); setMsg(ok); await load(); return r; } catch (e) { setErr(errText(e)); return null; } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Plans</h1>
        <button type="button" className={btnPrimary} onClick={() => { setErr(null); setF({ ...empty }); }}>Add plan</button>
      </div>
      <p className="mt-1 text-sm text-stone-700">Write your plans here: name, points and prices. When you set up a restaurant you pick one, and you can still change its price and dates for that restaurant.</p>
      <div className="mt-3 space-y-2" aria-live="polite">{error && <Alert>{error}</Alert>}{err && !f && !del && <Alert>{err}</Alert>}{msg && <Notice>{msg}</Notice>}</div>
      {!plans && !error && <p className="mt-6 text-stone-700">Loading…</p>}
      {plans && plans.length === 0 && <p className="mt-6 text-stone-800">No plans yet. Tap “Add plan” to write your first one.</p>}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {(plans ?? []).map((p) => (
          <li key={p.id} className="rounded-2xl border border-stone-200 bg-white p-4" data-testid={`plan-${p.name}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-lg font-bold">{p.name}</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${p.active ? 'bg-green-100 text-green-900' : 'bg-stone-200 text-stone-800'}`}>{p.active ? 'On sale' : 'Switched off'}</span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-stone-700">Setup</dt><dd className="font-bold">{formatPaise(p.setup_fee_paise)}</dd></div>
              <div><dt className="text-stone-700">Per month</dt><dd className="font-bold">{formatPaise(p.monthly_paise)}</dd></div>
              <div><dt className="text-stone-700">Per year</dt><dd className="font-bold">{formatPaise(p.yearly_paise)}</dd></div>
            </dl>
            {p.points.length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-stone-800">{p.points.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            <p className="mt-2 text-xs text-stone-700">Used by {String(p.in_use)} restaurant{Number(p.in_use) === 1 ? '' : 's'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={smallBtn} aria-label={`Edit plan ${p.name}`} onClick={() => { setErr(null); setF({ id: p.id, name: p.name, points: p.points.join('\n'), setup: paiseToRupees(p.setup_fee_paise), monthly: paiseToRupees(p.monthly_paise), yearly: paiseToRupees(p.yearly_paise), active: p.active, sort: String(p.sort_order) }); }}>Edit</button>
              <button type="button" className={smallBtn} aria-label={`Delete plan ${p.name}`} onClick={() => { setErr(null); setDel(p); }}>Delete</button>
            </div>
          </li>
        ))}
      </ul>

      <Sheet open={!!f} onClose={() => setF(null)} title={f?.id ? 'Edit plan' : 'Add plan'} closeLabel="Close">
        {f && (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const setup = rupeesToPaise(f.setup); const monthly = rupeesToPaise(f.monthly); const yearly = rupeesToPaise(f.yearly);
            if (setup === null || monthly === null || yearly === null) { setErr('Please type the prices as plain numbers, for example 2499.'); return; }
            const r = await run(() => adminPost('plan-save', { id: f.id, name: f.name, points: f.points.split('\n'), setup_fee_paise: setup, monthly_paise: monthly, yearly_paise: yearly, active: f.active, sort_order: Number(f.sort) || 0 }), 'Plan saved.');
            if (r) setF(null);
          }}>
            <label className="block text-sm font-semibold">Plan name<input required maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm font-semibold">Setup (₹)<input inputMode="decimal" value={f.setup} onChange={(e) => setF({ ...f, setup: e.target.value })} className={inputCls} /></label>
              <label className="block text-sm font-semibold">Per month (₹)<input inputMode="decimal" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} className={inputCls} /></label>
              <label className="block text-sm font-semibold">Per year (₹)<input inputMode="decimal" value={f.yearly} onChange={(e) => setF({ ...f, yearly: e.target.value })} className={inputCls} /></label>
            </div>
            <label className="block text-sm font-semibold">Plan points (one per line)
              <textarea rows={6} value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} className={inputCls} />
              <span className="block text-sm font-normal text-stone-700">Up to 20 points, 120 letters each. Empty lines are ignored.</span>
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />On sale (shown when you set up a restaurant)</label>
            <label className="block text-sm font-semibold">Order in the list<input inputMode="numeric" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} className={inputCls} /><span className="block text-sm font-normal text-stone-700">Smaller numbers come first.</span></label>
            {err && <Alert>{err}</Alert>}
            <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Save plan</button>
          </form>
        )}
      </Sheet>

      <Sheet open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name ?? 'plan'}?`} closeLabel="Close">
        <div className="space-y-4">
          <p className="text-stone-800">{Number(del?.in_use ?? 0) > 0 ? `${del?.name} is used by ${String(del?.in_use)} restaurant(s), so it cannot be deleted. Switch it off instead (Edit → untick “On sale”).` : 'This removes the plan from your list. Restaurants are not affected.'}</p>
          {err && <Alert>{err}</Alert>}
          <div className="flex gap-2">
            <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setDel(null)}>Cancel</button>
            <button type="button" disabled={busy || Number(del?.in_use ?? 0) > 0} className={`${btnPrimary} flex-1`} onClick={async () => { if (!del) return; const r = await run(() => adminPost('plan-delete', { id: del.id }), 'Plan deleted.'); if (r) setDel(null); }}>Delete plan</button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
