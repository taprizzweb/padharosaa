'use client';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Notice, Sheet, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { errText, fmtDateTime, inputCls } from '@/components/dash/api';
import { ApiFailure } from '@/lib/guest/client';
import { isPadHost } from '@/lib/padharosaa/areas';
import { addMonths, describeExpiry, endOfDayIst, expiryOf, istDate, paiseToRupees, rupeesToPaise, startOfDayIst } from '@/lib/billing';
import { formatPaise } from '@/lib/money';
import { FILTER_LABEL, counts, matches, monthlyRevenue, type ClientFilter } from '@/lib/admin-summary';
import { adminGet, adminPost, type Plan } from './AdminApi';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { GuestLinkPanel, type LinkState } from '@/components/padharosaa/RoomsLink';

interface Row {
  id: string; slug: string; name: string; status: 'active' | 'suspended'; plan: string; paid_until: string | null; created_at: string; last_order_at: string | null; order_count: number;
  plan_id: string | null; price_paise: number; billing_period: 'monthly' | 'yearly' | 'one_time'; setup_fee_paise: number; starts_at: string | null; auto_pause: boolean; grace_days: number; billing_note: string | null;
}
interface StaffRow { user_id: string; role: string; display_name: string; active: boolean; email: string | null }
interface AuditEntry { id: number; created_at: string; action: string; entity: string; actor_role: string | null; details: Record<string, unknown> | null }
const smallBtn = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50';

const PERIOD: Record<string, string> = { monthly: 'per month', yearly: 'per year', one_time: 'one time' };

export function AdminApp() {
  // on padharosaa.* the same panel speaks of hotels
  const [hotelHost, setHotelHost] = useState(false);
  useEffect(() => { setHotelHost(isPadHost(window.location.host)); }, []);
  const noun = hotelHost ? 'hotel' : 'restaurant';
  const Noun = hotelHost ? 'Hotels' : 'Restaurants';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [creating, setCreating] = useState(false);
  const [bill, setBill] = useState<Row | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [bf, setBf] = useState({ planId: '', planName: '', price: '', period: 'monthly', setup: '', starts: '', ends: '', auto: false, grace: '0', note: '' });
  const [ren, setRen] = useState<Row | null>(null);
  const [renName, setRenName] = useState('');
  const [dup, setDup] = useState<Row | null>(null);
  const [df, setDf] = useState({ name: '', slug: '', owner_name: '', owner_email: '' });
  const [loginRename, setLoginRename] = useState<StaffRow | null>(null);
  const [loginName, setLoginName] = useState('');
  const [audit, setAudit] = useState<{ row: Row; entries: AuditEntry[] | null } | null>(null);
  const [logins, setLogins] = useState<{ row: Row; staff: StaffRow[] | null } | null>(null);
  const [mailFor, setMailFor] = useState<StaffRow | null>(null);
  const [newMail, setNewMail] = useState('');
  const [adding, setAdding] = useState(false);
  const [af, setAf] = useState({ name: '', email: '', role: 'manager' });
  const [del, setDel] = useState<Row | null>(null);
  const [pad, setPad] = useState<{ row: Row; enabled: boolean | null } | null>(null);
  const [padMsg, setPadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [secret, setSecret] = useState<{ email: string; slug: string; password: string; title?: string } | null>(null);
  const [f, setF] = useState({ slug: '', name: '', owner_email: '', owner_name: '', plan: 'pilot', paid: '' });

  const load = async () => {
    try {
      const r = await fetch('/api/admin/restaurants', { credentials: 'same-origin', cache: 'no-store' });
      const b = (await r.json().catch(() => null)) as { restaurants?: Row[]; error?: { key?: string } } | null;
      if (r.status === 401) return window.location.assign('/login?next=/admin');
      if (r.status === 403 && b?.error?.key === 'mfa_required') return window.location.assign('/account/mfa?next=/admin');
      if (!r.ok) throw new ApiFailure(b?.error?.key ?? 'server_error', r.status);
      setRows(b?.restaurants ?? []);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await fn(); if (ok) setMsg(ok); await load(); return r; } catch (e) { setErr(errText(e)); return null; } finally { setBusy(false); }
  };

  const loadLogins = async (r: Row) => {
    const x = await adminGet<{ staff: StaffRow[] }>(`staff?id=${r.id}`);
    setLogins({ row: r, staff: x.staff });
  };

  const shown = useMemo(() => (rows ?? []).filter((r) => matches(r, filter) && `${r.name} ${r.slug}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q, filter]);
  const tally = useMemo(() => counts(rows ?? []), [rows]);
  const badge = (r: Row) => {
    const e = expiryOf(r.paid_until, r.auto_pause, r.grace_days);
    const tone = e.kind === 'ended' ? 'bg-red-100 text-red-900' : e.kind === 'soon' || e.kind === 'grace' ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-800';
    return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone}`} data-testid="expiry">{describeExpiry(e)}</span>;
  };
  const openBilling = async (r: Row) => {
    setErr(null);
    setBill(r);
    setBf({ planId: r.plan_id ?? '', planName: r.plan, price: paiseToRupees(r.price_paise), period: r.billing_period, setup: paiseToRupees(r.setup_fee_paise), starts: istDate(r.starts_at), ends: istDate(r.paid_until), auto: r.auto_pause, grace: String(r.grace_days), note: r.billing_note ?? '' });
    try { setPlans((await adminGet<{ plans: Plan[] }>('plans')).plans); } catch { setPlans([]); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">{Noun}</h1>
        <button type="button" className={btnPrimary} onClick={() => { setErr(null); setF({ slug: '', name: '', owner_email: '', owner_name: '', plan: 'pilot', paid: '' }); setCreating(true); }}>{hotelHost ? 'Create hotel' : 'Create restaurant'}</button>
      </div>
      <label className="mt-3 block text-sm font-semibold">Search
        <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} />
      </label>
      {rows && (
        <section aria-label="At a glance" className="mt-3 rounded-2xl border border-stone-200 bg-white p-4" data-testid="admin-glance">
          <p className="text-sm text-stone-700">Clients pay about <strong className="text-lg text-stone-900">{formatPaise(monthlyRevenue(rows))}</strong> a month · {tally.active} active · {tally.renew} to renew soon · {tally.quiet} quiet this week</p>
          <div role="group" aria-label="Show" className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(FILTER_LABEL) as ClientFilter[]).map((k) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${filter === k ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white text-stone-900'}`}>{FILTER_LABEL[k]} {tally[k]}</button>
            ))}
          </div>
        </section>
      )}
      <div className="mt-3 space-y-2" aria-live="polite">{error && <Alert>{error}</Alert>}{err && !creating && !bill && !ren && !dup && !logins && !del && <Alert>{err}</Alert>}{msg && <Notice>{msg}</Notice>}</div>
      {!rows && !error && <p className="mt-6 text-stone-700">Loading…</p>}
      <ul className="mt-4 space-y-3">
        {shown.map((r) => (
          <li key={r.id} className="rounded-2xl border border-stone-200 bg-white p-4" data-testid={`restaurant-${r.slug}`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-lg font-bold">{r.name} <span className="font-mono text-sm font-normal text-stone-700">/{r.slug}</span></p>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${r.status === 'active' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`}>{r.status === 'active' ? 'Active' : 'Suspended'}</span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-800">
              <span>Plan: <strong>{r.plan}</strong></span>
              <span>· {formatPaise(r.price_paise)} {PERIOD[r.billing_period]}{r.setup_fee_paise > 0 ? ` · setup ${formatPaise(r.setup_fee_paise)}` : ''}</span>
              {badge(r)}
            </p>
            <p className="mt-0.5 text-sm text-stone-700">
              {r.paid_until ? `Ends ${fmtDateTime(r.paid_until)}` : 'No end date'}{r.auto_pause ? ` · pauses itself${r.grace_days ? ` after ${r.grace_days} grace day${r.grace_days === 1 ? '' : 's'}` : ''}` : ''}
              {' · '}Last order: {r.last_order_at ? fmtDateTime(r.last_order_at) : 'none yet'} · Orders: {r.order_count}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={smallBtn} disabled={busy} onClick={() => void run(() => adminPost('set-status', { id: r.id, status: r.status === 'active' ? 'suspended' : 'active' }), r.status === 'active' ? `${r.name} is suspended: guests cannot order and staff cannot make changes.` : `${r.name} is active again.`)}>{r.status === 'active' ? `Suspend ${r.name}` : `Activate ${r.name}`}</button>
              <button type="button" className={smallBtn} onClick={() => void openBilling(r)} aria-label={`Plan and billing for ${r.name}`}>Plan &amp; dates</button>
              <button type="button" className={smallBtn} onClick={() => { setErr(null); setRen(r); setRenName(r.name); }} aria-label={`Rename ${r.name}`}>Rename</button>
              <button type="button" className={smallBtn} onClick={() => { setErr(null); setDup(r); setDf({ name: `${r.name} copy`, slug: '', owner_name: '', owner_email: '' }); }} aria-label={`Duplicate ${r.name}`}>Duplicate</button>
              <button type="button" className={smallBtn} onClick={async () => { setAudit({ row: r, entries: null }); try { const x = await adminGet<{ entries: AuditEntry[] }>(`audit?id=${r.id}`); setAudit({ row: r, entries: x.entries }); } catch (e) { setAudit(null); setErr(errText(e)); } }} aria-label={`Activity log for ${r.name}`}>Activity log</button>
              <button type="button" className={smallBtn} onClick={async () => { setErr(null); setMailFor(null); setLogins({ row: r, staff: null }); try { await loadLogins(r); } catch (e) { setLogins(null); setErr(errText(e)); } }} aria-label={`Logins of ${r.name}`}>Logins</button>
              <button type="button" className={smallBtn} onClick={async () => { setPadMsg(null); setPad({ row: r, enabled: null }); try { await apiGet(`/api/padharosaa/v1/platform/hotels/${r.id}/qr`); setPad({ row: r, enabled: true }); } catch { setPad({ row: r, enabled: false }); } }} aria-label={`Padharosaa hotel of ${r.name}`}>Padharosaa</button>
              <button type="button" className={smallBtn} disabled={busy} onClick={async () => { setErr(null); const ok = await run(() => adminPost('menu-open', { id: r.id })); if (ok !== null) window.location.assign('/dash/menu'); }} aria-label={`Edit the menu of ${r.name}`}>Edit menu</button>
              <a className={smallBtn} href={`/api/admin/export?id=${r.id}`} download aria-label={`Export data of ${r.name}`}>Export data</a>
              <button type="button" className={smallBtn} onClick={() => { setErr(null); setDel(r); setTyped(''); }} aria-label={`Delete ${r.name}`}>Delete…</button>
            </div>
          </li>
        ))}
      </ul>
      {rows && shown.length === 0 && <p className="mt-6 text-stone-800">No {noun}s found.</p>}

      <Sheet open={creating} onClose={() => setCreating(false)} title={hotelHost ? 'Create hotel' : 'Create restaurant'} closeLabel="Close">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => adminPost<{ owner_email: string; slug: string; temporary_password: string }>('create-restaurant', { slug: f.slug, name: f.name, owner_email: f.owner_email, owner_name: f.owner_name, plan: f.plan, paid_until: endOfDayIst(f.paid) }));
          if (r) { setCreating(false); setSecret({ email: r.owner_email, slug: r.slug, password: r.temporary_password }); }
        }}>
          <label className="block text-sm font-semibold">Restaurant name<input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">Web address (after the domain)<input required value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} className={inputCls} /><span className="text-sm font-normal text-stone-700">Lowercase letters, numbers and hyphens, for example spice-garden</span></label>
          <label className="block text-sm font-semibold">Owner name<input required maxLength={60} value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">Owner email<input type="email" required inputMode="email" value={f.owner_email} onChange={(e) => setF({ ...f, owner_email: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">Plan<input required maxLength={30} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">Paid until (optional)<input type="date" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} className={inputCls} /></label>
          {err && <Alert>{err}</Alert>}
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Create restaurant and owner login</button>
        </form>
      </Sheet>

      <Sheet open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? 'Restaurant created'} closeLabel="Close">
        <div className="space-y-3">
          <p className="text-stone-800">Give these details to {secret?.email}. They sign in with this email and temporary password, then choose their own password. <strong>This password is shown only once.</strong></p>
          <p className="break-all rounded-xl bg-stone-100 p-3 font-mono text-lg" data-testid="temp-password">{secret?.password}</p>
          <button type="button" className={`${btnPrimary} w-full`} onClick={() => setSecret(null)}>I have saved it</button>
        </div>
      </Sheet>

      <Sheet open={!!logins} onClose={() => { setLogins(null); setMailFor(null); setAdding(false); setLoginRename(null); }} title={`Logins: ${logins?.row.name ?? ''}`} closeLabel="Close">
        {logins?.staff && (
          <div className="mb-3">
            {!adding ? (
              <button type="button" className={`${btnPrimary} w-full`} onClick={() => { setErr(null); setAf({ name: '', email: '', role: logins.staff!.some((x) => x.role === 'owner') ? 'manager' : 'owner' }); setAdding(true); }}>Add login</button>
            ) : (
              <form className="space-y-3 rounded-xl border border-stone-200 p-3" onSubmit={async (e) => {
                e.preventDefault();
                const r = await run(() => adminPost<{ email: string; temporary_password: string }>('staff-add', { id: logins.row.id, email: af.email, name: af.name, role: af.role }));
                if (r) { setAdding(false); setLogins(null); setSecret({ email: r.email, slug: logins.row.slug, password: r.temporary_password, title: 'Login created' }); }
              }}>
                <label className="block text-sm font-semibold">Name<input required maxLength={60} value={af.name} onChange={(e) => setAf({ ...af, name: e.target.value })} className={inputCls} /></label>
                <label className="block text-sm font-semibold">Email<input type="email" required inputMode="email" value={af.email} onChange={(e) => setAf({ ...af, email: e.target.value })} className={inputCls} /></label>
                <label className="block text-sm font-semibold">Role
                  <select value={af.role} onChange={(e) => setAf({ ...af, role: e.target.value })} className={inputCls}>
                    <option value="owner">Owner</option><option value="manager">Manager</option><option value="waiter">Waiter</option><option value="kitchen">Kitchen</option>
                  </select>
                </label>
                {err && <Alert>{err}</Alert>}
                <div className="flex gap-2">
                  <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setAdding(false)}>Cancel</button>
                  <button type="submit" disabled={busy} className={`${btnPrimary} flex-1`}>Create login</button>
                </div>
              </form>
            )}
          </div>
        )}
        {!logins?.staff ? <p>Loading…</p> : logins.staff.length === 0 ? <p>No logins for this restaurant.</p> : (
          <ul className="space-y-3">
            {logins.staff.map((m) => (
              <li key={m.user_id} className="rounded-xl border border-stone-200 p-3 text-sm" data-testid={`login-${m.role}`}>
                <p className="font-semibold">{m.display_name} · {m.role}{m.active ? '' : ' (switched off)'}</p>
                <p className="break-all text-stone-800">{m.email ?? 'no email'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={smallBtn} disabled={busy} aria-label={`Reset password of ${m.display_name}`} onClick={async () => {
                    const r = await run(() => adminPost<{ temporary_password: string }>('staff-reset-password', { id: logins.row.id, user_id: m.user_id }));
                    if (r) { setLogins(null); setSecret({ email: m.email ?? m.display_name, slug: logins.row.slug, password: r.temporary_password, title: 'New temporary password' }); }
                  }}>Reset password</button>
                  <button type="button" className={smallBtn} disabled={busy} aria-label={`Rename ${m.display_name}`} onClick={() => { setErr(null); setLoginRename(m); setLoginName(m.display_name); }}>Change name</button>
                  <button type="button" className={smallBtn} disabled={busy} aria-label={`Change email of ${m.display_name}`} onClick={() => { setErr(null); setMailFor(m); setNewMail(m.email ?? ''); }}>Change email</button>
                </div>
                {loginRename?.user_id === m.user_id && (
                  <form className="mt-3 space-y-2" onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await run(() => adminPost('staff-rename', { id: logins.row.id, user_id: m.user_id, name: loginName }), 'Name changed.');
                    if (r) { setLoginRename(null); await loadLogins(logins.row); }
                  }}>
                    <label className="block text-sm font-semibold">New name<input required maxLength={60} value={loginName} onChange={(e) => setLoginName(e.target.value)} className={inputCls} /></label>
                    {err && <Alert>{err}</Alert>}
                    <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Save name</button>
                  </form>
                )}
                {mailFor?.user_id === m.user_id && (
                  <form className="mt-3 space-y-2" onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await run(() => adminPost('staff-change-email', { id: logins.row.id, user_id: m.user_id, email: newMail }), 'Email changed. The old email no longer works.');
                    if (r) { setMailFor(null); await loadLogins(logins.row); }
                  }}>
                    <label className="block text-sm font-semibold">New email<input type="email" required inputMode="email" value={newMail} onChange={(e) => setNewMail(e.target.value)} className={inputCls} /></label>
                    {err && <Alert>{err}</Alert>}
                    <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Save email</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet open={!!bill} onClose={() => setBill(null)} title={`Plan & dates: ${bill?.name ?? ''}`} closeLabel="Close">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!bill) return;
          const price = rupeesToPaise(bf.price); const setup = rupeesToPaise(bf.setup);
          if (price === null || setup === null) { setErr('Please type the prices as plain numbers, for example 2499.'); return; }
          const r = await run(() => adminPost('billing-save', {
            id: bill.id, plan_id: bf.planId || null, plan_name: bf.planName, price_paise: price, period: bf.period, setup_fee_paise: setup,
            starts_at: startOfDayIst(bf.starts), paid_until: endOfDayIst(bf.ends), auto_pause: bf.auto, grace_days: Number(bf.grace) || 0, note: bf.note,
          }), 'Plan and dates saved.');
          if (r) setBill(null);
        }}>
          <label className="block text-sm font-semibold">Plan
            <select value={bf.planId} onChange={(e) => {
              const pl = plans.find((x) => x.id === e.target.value);
              if (!pl) { setBf({ ...bf, planId: '' }); return; }
              setBf({ ...bf, planId: pl.id, planName: pl.name, setup: paiseToRupees(pl.setup_fee_paise), price: paiseToRupees(bf.period === 'yearly' ? pl.yearly_paise : pl.monthly_paise) });
            }} className={inputCls}>
              <option value="">Custom (type your own)</option>
              {plans.filter((p) => p.active || p.id === bf.planId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">Plan name shown<input required maxLength={40} value={bf.planName} onChange={(e) => setBf({ ...bf, planName: e.target.value })} className={inputCls} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold">Billing
              <select value={bf.period} onChange={(e) => {
                const period = e.target.value;
                const pl = plans.find((x) => x.id === bf.planId);
                setBf({ ...bf, period, price: pl && period !== 'one_time' ? paiseToRupees(period === 'yearly' ? pl.yearly_paise : pl.monthly_paise) : bf.price });
              }} className={inputCls}>
                <option value="monthly">Every month</option><option value="yearly">Every year</option><option value="one_time">One time</option>
              </select>
            </label>
            <label className="block text-sm font-semibold">Price (₹)<input inputMode="decimal" value={bf.price} onChange={(e) => setBf({ ...bf, price: e.target.value })} className={inputCls} /></label>
          </div>
          <label className="block text-sm font-semibold">Setup fee (₹)<input inputMode="decimal" value={bf.setup} onChange={(e) => setBf({ ...bf, setup: e.target.value })} className={inputCls} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold">Starts on<input type="date" value={bf.starts} onChange={(e) => setBf({ ...bf, starts: e.target.value })} className={inputCls} /></label>
            <label className="block text-sm font-semibold">Ends on<input type="date" value={bf.ends} onChange={(e) => setBf({ ...bf, ends: e.target.value })} className={inputCls} /></label>
          </div>
          <div>
            <p className="text-sm font-semibold">Set the end date from the start date (or today)</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {([['1 month', 1], ['3 months', 3], ['6 months', 6], ['1 year', 12]] as const).map(([l, m]) => (
                <button key={l} type="button" className={smallBtn} onClick={() => setBf({ ...bf, ends: addMonths(bf.starts || istDate(new Date().toISOString()), m) })}>+ {l}</button>
              ))}
              <button type="button" className={smallBtn} onClick={() => setBf({ ...bf, ends: '' })}>No end date</button>
            </div>
          </div>
          <div className="space-y-2 rounded-xl border border-stone-200 p-3">
            <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={bf.auto} onChange={(e) => setBf({ ...bf, auto: e.target.checked })} />Pause the menu automatically after the end date</label>
            <label className="block text-sm font-semibold">Grace days before it pauses (0 to 60)<input inputMode="numeric" value={bf.grace} onChange={(e) => setBf({ ...bf, grace: e.target.value })} disabled={!bf.auto} className={inputCls} /></label>
            <p className="text-sm text-stone-700">When paused, guests see “not taking orders” and cannot order. The owner can still log in. Renew by moving the end date.</p>
          </div>
          <label className="block text-sm font-semibold">Note (only you see this)<input maxLength={300} value={bf.note} onChange={(e) => setBf({ ...bf, note: e.target.value })} className={inputCls} /></label>
          {err && <Alert>{err}</Alert>}
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Save</button>
        </form>
      </Sheet>

      <Sheet open={!!ren} onClose={() => setRen(null)} title={`Rename ${ren?.name ?? ''}`} closeLabel="Close">
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (!ren) return; const r = await run(() => adminPost('restaurant-rename', { id: ren.id, name: renName }), 'Name changed.'); if (r) setRen(null); }}>
          <label className="block text-sm font-semibold">Restaurant name<input required maxLength={80} value={renName} onChange={(e) => setRenName(e.target.value)} className={inputCls} /></label>
          <p className="text-sm text-stone-700">Only the name changes. The web address and printed QR codes keep working.</p>
          {err && <Alert>{err}</Alert>}
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Save name</button>
        </form>
      </Sheet>

      <Sheet open={!!dup} onClose={() => setDup(null)} title={`Duplicate ${dup?.name ?? ''}`} closeLabel="Close">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!dup) return;
          const r = await run(() => adminPost<{ owner_email: string; slug: string; temporary_password: string; photos_failed: number }>('duplicate-restaurant', { source_id: dup.id, slug: df.slug, name: df.name, owner_email: df.owner_email, owner_name: df.owner_name }));
          if (r) { setDup(null); setSecret({ email: r.owner_email, slug: r.slug, password: r.temporary_password, title: 'Copy created' }); }
        }}>
          <p className="text-sm text-stone-800">Makes a new restaurant with the same look, categories and dishes (and photos). Tables, QR codes, orders, staff, plan and dates are <strong>not</strong> copied. The new owner gets a temporary password.</p>
          <label className="block text-sm font-semibold">New restaurant name<input required maxLength={80} value={df.name} onChange={(e) => setDf({ ...df, name: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">New web address<input required value={df.slug} onChange={(e) => setDf({ ...df, slug: e.target.value.toLowerCase() })} className={inputCls} /><span className="text-sm font-normal text-stone-700">Lowercase letters, numbers and hyphens</span></label>
          <label className="block text-sm font-semibold">New owner name<input required maxLength={60} value={df.owner_name} onChange={(e) => setDf({ ...df, owner_name: e.target.value })} className={inputCls} /></label>
          <label className="block text-sm font-semibold">New owner email<input type="email" required inputMode="email" value={df.owner_email} onChange={(e) => setDf({ ...df, owner_email: e.target.value })} className={inputCls} /></label>
          {err && <Alert>{err}</Alert>}
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Create the copy</button>
        </form>
      </Sheet>

      <Sheet open={!!audit} onClose={() => setAudit(null)} title={`Activity log: ${audit?.row.name ?? ''}`} closeLabel="Close">
        {!audit?.entries ? <p>Loading…</p> : audit.entries.length === 0 ? <p>Nothing recorded yet.</p> : (
          <ul className="space-y-2">
            {audit.entries.map((a) => (
              <li key={a.id} className="rounded-xl border border-stone-200 p-3 text-sm">
                <p className="font-semibold">{a.action.replace(/_/g, ' ')} · {a.entity}</p>
                <p className="text-stone-700">{fmtDateTime(a.created_at)} · {a.actor_role?.replace('_', ' ') ?? 'system'}</p>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet open={!!pad} onClose={() => setPad(null)} title={`Padharosaa: ${pad?.row.name ?? ''}`} closeLabel="Close">
        {pad && (
          <div className="space-y-4">
            {padMsg && <p role={padMsg.ok ? 'status' : 'alert'} className={`rounded-xl p-3 text-sm font-semibold ${padMsg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{padMsg.text}</p>}
            {pad.enabled === null && <p role="status">…</p>}
            {pad.enabled === false && (
              <div className="space-y-3">
                <p className="text-stone-800">This restaurant is not a Padharosaa hotel yet. Enabling it gives it the guest concierge, the hotel pages and a guest link. Nothing in its menu changes.</p>
                <button type="button" className={btnPrimary} onClick={async () => { try { await apiPost(`/api/padharosaa/v1/platform/hotels/${pad.row.id}/enable`, { timezone: 'Asia/Kolkata' }); setPad({ row: pad.row, enabled: true }); setPadMsg({ ok: true, text: 'Padharosaa is on for this hotel. The guest link is below.' }); } catch { setPadMsg({ ok: false, text: 'Padharosaa could not be enabled. Please try again.' }); } }}>Enable Padharosaa</button>
              </div>
            )}
            {pad.enabled && <DemoCard hotelId={pad.row.id} slug={pad.row.slug} flash={(ok, text) => setPadMsg({ ok, text })} />}
            {pad.enabled && <GuestLinkPanel bare slug={pad.row.slug} flash={(ok, text) => setPadMsg({ ok, text })} load={() => apiGet<LinkState>(`/api/padharosaa/v1/platform/hotels/${pad.row.id}/qr`)} create={(password) => apiPost<{ link: string }>(`/api/padharosaa/v1/platform/hotels/${pad.row.id}/qr`, { password })} />}
          </div>
        )}
      </Sheet>

      <Sheet open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name ?? ''}?`} closeLabel="Close">
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (!del) return; const r = await run(() => adminPost('delete-restaurant', { id: del.id, confirm_slug: typed }), `${del.name} and all its data were deleted.`); if (r) setDel(null); }}>
          <p className="text-stone-800">This <strong>permanently deletes</strong> the restaurant, its menu, orders, photos and staff logins. It cannot be undone. Consider exporting the data first.</p>
          <label className="block text-sm font-semibold">Type <span className="font-mono">{del?.slug}</span> to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={inputCls} />
          </label>
          {err && <Alert>{err}</Alert>}
          <div className="flex gap-2">
            <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setDel(null)}>Cancel</button>
            <button type="submit" disabled={busy || typed !== del?.slug} className={`${btnPrimary} flex-1`}>Delete forever</button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}

/** The public demo link of a hotel: anyone with it tries the guest app on their phone, no sign-in. Only for demo or pitch hotels, never a real one. */
function DemoCard({ hotelId, slug, flash }: { hotelId: string; slug: string; flash: (ok: boolean, text: string) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void apiGet<{ is_demo?: boolean }>(`/api/padharosaa/v1/platform/hotels/${hotelId}/qr`).then((r) => setOn(!!r.is_demo)).catch(() => setOn(false)); }, [hotelId]);
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.host.startsWith('padharosaa.') ? '/try/' : '/padharosaa/try/'}${slug}`;
  const set = async (next: boolean) => {
    try { await apiPost(`/api/padharosaa/v1/platform/hotels/${hotelId}/demo`, { on: next }); setOn(next); flash(true, next ? 'The public demo is on. Share the link below.' : 'The public demo is off. The link no longer works.'); }
    catch { flash(false, 'That could not be changed. Please try again.'); }
  };
  if (on === null) return null;
  return (
    <section className="rounded-2xl border border-stone-300 p-4" aria-label="Public demo">
      <h3 className="text-base font-extrabold">Public demo link</h3>
      <p className="mt-1 text-sm text-stone-800">For a pitch or a demo hotel only. Anyone with the link can try the guest app with no sign-in, in a demo room, and their requests answer themselves. Never switch this on for a hotel with real guests.</p>
      <label className="mt-2 flex min-h-11 items-center gap-3 text-base font-semibold"><input type="checkbox" className="size-5" checked={on} onChange={(e) => void set(e.target.checked)} />Public demo is on</label>
      {on && <p className="mt-2 break-all rounded-xl bg-stone-100 p-3 text-sm font-semibold" data-testid="demo-link">{link}</p>}
    </section>
  );
}
