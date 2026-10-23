'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { AlertSound } from '@/components/staff/sound';
import { ApiFailure } from '@/lib/guest/client';

type Team = 'concierge' | 'front_desk' | 'housekeeping' | 'kitchen' | 'maintenance' | 'manager';
interface Req {
  id: string; type: string; team: Team; label: string; detail: string | null; urgent: boolean; status: string; handover: string | null; version: number;
  created_at: string; accepted_at: string | null; room: string; guest_name: string; diet: string | null; occasion: string | null; mobile: string | null; guests_in_room: number;
}
interface Alerts { room_dining: boolean; muted: Team[]; teams: Team[] }
const TEAM_NAME: Record<Team, string> = { concierge: 'Concierge', front_desk: 'Front desk', housekeeping: 'Housekeeping', kitchen: 'Kitchen', maintenance: 'Maintenance', manager: 'Manager' };
const PRESETS = ['Not available right now', 'We do not offer this', 'Already on the way', 'Fully booked, please choose another time', 'We will call you'];
const OUTCOMES = [['fixed', 'Fixed'], ['replacement_sent', 'Replacement sent'], ['room_changed', 'Room changed'], ['compensation_offered', 'Compensation offered']] as const;
const OPEN = ['received', 'accepted', 'preparing', 'ready'];

const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

export function DeskApp({ role, hotel, title = 'Padharosaa desk' }: { role: string; hotel: string; title?: string }) {
  // on padharosaa.* the menu live screen is reached through /orders (the plain /staff address belongs to the desk there)
  const [ordersHref, setOrdersHref] = useState('/staff');
  useEffect(() => { if (/^padharosaa\./i.test(location.host)) setOrdersHref('/orders'); }, []);
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const sound = useRef(new AlertSound());
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [b, a] = await Promise.all([apiGet<{ requests: Req[] }>('/api/padharosaa/v1/staff/board'), apiGet<Alerts>('/api/padharosaa/v1/staff/alerts')]);
      setReqs(b.requests); setAlerts(a); setErr(null);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) window.location.assign('/login?next=/padharosaa/desk');
      else setErr('Could not reach the server. Retrying…');
    }
  }, []);
  useEffect(() => { void load(); const i = setInterval(() => { if (!document.hidden) void load(); tick((n) => n + 1); }, 4000); return () => clearInterval(i); }, [load]);

  const muted = useMemo(() => new Set(alerts?.muted ?? []), [alerts]);
  const open = useMemo(() => (reqs ?? []).filter((r) => OPEN.includes(r.status)), [reqs]);
  const pending = open.filter((r) => r.status === 'received' && !muted.has(r.team));

  // alarm: once for each new request, and again every 20 seconds while something unmuted is still waiting
  useEffect(() => {
    if (!reqs) return;
    const fresh = pending.filter((r) => !seen.current.has(r.id));
    for (const r of reqs) seen.current.add(r.id);
    if (first.current) { first.current = false; return; }
    if (fresh.length) sound.current.play(fresh.some((r) => r.urgent || r.type === 'help') ? 'help' : fresh[0]!.type === 'food' ? 'order' : 'waiter');
  }, [reqs, pending]);
  useEffect(() => { if (!pending.length) return; const i = setInterval(() => sound.current.play(pending.some((r) => r.urgent) ? 'help' : 'waiter'), 20000); return () => clearInterval(i); }, [pending]);

  const act = async (r: Req, action: string, body: Record<string, unknown> = {}) => {
    try { await apiPost(`/api/padharosaa/v1/staff/requests/${r.id}/${action}`, { version: r.version, ...body }); setErr(null); }
    catch (e) { setErr(e instanceof ApiFailure && e.status === 409 ? 'Someone else just changed this request. The screen has been refreshed.' : 'That did not go through. Please try again.'); }
    await load();
  };
  const toggleMute = async (team: Team) => { await apiPost('/api/padharosaa/v1/staff/alerts', { team, muted: !muted.has(team) }); await load(); };

  return (
    <div className="mx-auto min-h-dvh max-w-3xl bg-stone-50 px-4 pb-24 pt-4 text-stone-900">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-extrabold">{title}</h1><p className="text-sm text-stone-700">{hotel}</p></div>
        <div className="flex gap-2">
          <button type="button" className="min-h-11 rounded-full border-2 border-stone-800 px-4 text-sm font-bold" onClick={async () => setSoundOn(await sound.current.enable())} aria-pressed={soundOn}>{soundOn ? 'Alarm sound is ON' : 'Turn alarm sound on'}</button>
          <Link href={ordersHref} prefetch={false} className="inline-flex min-h-11 items-center rounded-full border-2 border-stone-800 px-4 text-sm font-bold">Food orders</Link>
          {(role === 'owner' || role === 'manager') && <Link href={`/padharosaa/${role}`} className="inline-flex min-h-11 items-center rounded-full bg-stone-900 px-4 text-sm font-bold text-white">Manage</Link>}
        </div>
      </header>
      {alerts && (
        <section aria-label="My alerts" className="mt-3 rounded-2xl bg-white p-3 shadow-sm">
          <h2 className="text-sm font-bold">My alerts (only for me)</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {alerts.teams.map((t) => <button key={t} type="button" aria-pressed={!muted.has(t)} onClick={() => void toggleMute(t)} className={`min-h-11 rounded-full border-2 px-3 text-sm font-semibold ${muted.has(t) ? 'border-stone-400 text-stone-700' : 'border-emerald-800 bg-emerald-50 text-emerald-950'}`}>{TEAM_NAME[t]}: {muted.has(t) ? 'muted' : 'on'}</button>)}
          </div>
        </section>
      )}
      {err && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">{err}</p>}
      <h2 className="mt-5 text-sm font-bold uppercase tracking-wide text-stone-700">Open ({open.length})</h2>
      {reqs && open.length === 0 && <p className="mt-2 rounded-2xl bg-white p-6 text-center text-stone-700">All clear. New requests appear here by themselves.</p>}
      <ul className="mt-2 space-y-3">{open.map((r) => <Card key={r.id} r={r} role={role} roomDining={alerts?.room_dining ?? true} muted={muted.has(r.team)} act={act} />)}</ul>
    </div>
  );
}

function Card({ r, role, roomDining, muted, act }: { r: Req; role: string; roomDining: boolean; muted: boolean; act: (r: Req, a: string, b?: Record<string, unknown>) => Promise<void> }) {
  const [mode, setMode] = useState<null | 'decline' | 'pass' | 'resolve'>(null);
  const [reason, setReason] = useState('');
  const age = mins(r.created_at);
  const urgentCls = r.urgent ? 'border-red-700' : r.status === 'received' ? 'border-amber-600' : 'border-stone-300';
  const btn = 'min-h-11 rounded-xl px-4 text-sm font-bold';
  return (
    <li className={`rounded-2xl border-l-8 bg-white p-4 shadow-sm ${urgentCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-lg font-extrabold">Room {r.room} <span className="font-semibold text-stone-700">· {r.guest_name}</span></p>{r.mobile && <a href={`tel:${r.mobile.replace(/[^+\d]/g, '')}`} className="text-sm font-semibold underline">{r.mobile}</a>}</div>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-bold">{age} min</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-xs font-bold">
        {r.urgent && <span className="rounded-full bg-red-800 px-2 py-1 text-white">URGENT</span>}
        <span className="rounded-full bg-stone-200 px-2 py-1">{TEAM_NAME[r.team]}</span>
        {r.diet && <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-950">{r.diet.replace('_', ' ')}</span>}
        {r.occasion && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-950">{r.occasion}</span>}
        {muted && <span className="rounded-full bg-stone-100 px-2 py-1 text-stone-700">alerts muted for me</span>}
        {r.handover && <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-950">{r.handover === 'deliver' ? 'Room delivery' : 'Takeaway'}</span>}
      </div>
      <p className="mt-2 text-base font-semibold">{r.label}</p>
      {r.detail && <p className="text-sm text-stone-700">{r.detail}</p>}
      {r.type === 'food' && r.status !== 'completed' && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="How will this reach the guest?">
          {roomDining && <button type="button" className={`${btn} ${r.handover === 'deliver' ? 'bg-sky-900 text-white' : 'border-2 border-sky-900 text-sky-950'}`} onClick={() => void act(r, 'handover', { mode: 'deliver' })}>Room delivery</button>}
          <button type="button" className={`${btn} ${r.handover === 'takeaway' ? 'bg-sky-900 text-white' : 'border-2 border-sky-900 text-sky-950'}`} onClick={() => void act(r, 'handover', { mode: 'takeaway' })}>Takeaway</button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === 'received' && <button type="button" className={`${btn} bg-emerald-800 text-white`} onClick={() => void act(r, 'accept')}>Accept</button>}
        {r.status !== 'received' && r.type !== 'help' && <button type="button" className={`${btn} bg-emerald-800 text-white`} onClick={() => void act(r, 'complete')}>Mark done</button>}
        {r.type === 'help' && <button type="button" className={`${btn} bg-emerald-800 text-white`} onClick={() => setMode(mode === 'resolve' ? null : 'resolve')}>Resolved…</button>}
        {role !== 'kitchen' && r.type !== 'food' && <button type="button" className={`${btn} border-2 border-stone-700`} onClick={() => setMode(mode === 'pass' ? null : 'pass')}>Pass to team</button>}
        {r.status !== 'preparing' && r.status !== 'ready' && <button type="button" className={`${btn} border-2 border-red-800 text-red-900`} onClick={() => setMode(mode === 'decline' ? null : 'decline')}>Decline…</button>}
      </div>
      {mode === 'decline' && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 3) void act(r, 'dismiss', { reason: reason.trim() }); }}>
          <label className="block text-sm font-semibold">Reason or information for the guest (they will see this)
            <textarea required minLength={3} maxLength={140} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border-2 border-stone-300 p-2 text-base" />
          </label>
          <div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p} type="button" className="min-h-11 rounded-full bg-stone-100 px-3 text-sm font-semibold" onClick={() => setReason(p)}>{p}</button>)}</div>
          <button type="submit" disabled={reason.trim().length < 3} className={`${btn} bg-red-800 text-white disabled:opacity-50`}>Send to guest</button>
        </form>
      )}
      {mode === 'pass' && <div className="mt-3 flex flex-wrap gap-2">{(Object.keys(TEAM_NAME) as Team[]).filter((t) => t !== r.team).map((t) => <button key={t} type="button" className={`${btn} bg-stone-100`} onClick={() => void act(r, 'pass', { team: t })}>{TEAM_NAME[t]}</button>)}</div>}
      {mode === 'resolve' && <div className="mt-3 flex flex-wrap gap-2">{OUTCOMES.map(([k, l]) => <button key={k} type="button" className={`${btn} bg-stone-100`} onClick={() => void act(r, 'resolve', { outcome: k })}>{l}</button>)}</div>}
    </li>
  );
}
