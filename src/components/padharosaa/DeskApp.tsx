'use client';

import { dialNumber } from '@/lib/padharosaa/phone';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { AlertSound } from '@/components/staff/sound';
import { ApiFailure } from '@/lib/guest/client';
import { GROUP_LABEL, GROUP_TEAMS, soundsFor, type Group } from '@/lib/padharosaa/areas';
import { AreaNav, type NavCurrent } from './AreaNav';
import { BuffetManager } from './BuffetManager';
import { ThemeToggle } from '@/components/ui/ns';
import { CheckoutPanel } from './CheckoutPanel';
import { StayCodeTool } from './StayCode';
import { OrderCardDesk, TableCallDesk, type OrderDeskActions, type TableCallActions } from './DeskOrders';
import type { BoardOrder, BoardRequest, BoardSession } from '@/lib/staff/logic';

type Team = 'concierge' | 'front_desk' | 'housekeeping' | 'kitchen' | 'maintenance' | 'manager';
interface Req {
  id: string; type: string; team: Team; label: string; detail: string | null; urgent: boolean; status: string; handover: string | null; version: number;
  created_at: string; accepted_at: string | null; completed_at?: string | null; assigned_to?: string | null; assigned_name?: string | null; room: string; guest_name: string; diet: string | null; occasion: string | null; mobile: string | null; guests_in_room: number;
}
interface Person { user_id: string; name: string; role: string; department: string | null }
interface Alerts { room_dining: boolean; kitchen_display?: boolean; muted: Team[]; teams: Team[] }
const TEAM_NAME: Record<Team, string> = { concierge: 'Concierge', front_desk: 'Front desk', housekeeping: 'Housekeeping', kitchen: 'Kitchen', maintenance: 'Maintenance', manager: 'Manager' };
const PRESETS = ['Not available right now', 'We do not offer this', 'Already on the way', 'Fully booked, please choose another time', 'We will call you'];
/** Reasons that fit the kind of request: a cab is never "fully booked, choose another time" in the same way a table is. */
const PRESETS_BY_TYPE: Record<string, string[]> = {
  food: ['Not available right now', 'Kitchen is closed', 'Please choose something else', 'We will call you'],
  reservation: ['Fully booked, please choose another time', 'We will call you'],
  cab: ['No car is free at that time, please choose another time', 'Please tell us a different destination or time', 'We will call you'],
  wake: ['We cannot take a wake-up call at that time', 'We will call you'],
  late_checkout: ['Late check-out is not possible for your room today', 'Late check-out is possible until an earlier time, we will call you', 'We will call you'],
  housekeeping: ['Already on the way', 'Housekeeping will come later, we will call you', 'We will call you'],
  help: ['Already on the way', 'We will call you'],
  checkout: ['Please wait a little, we will call you', 'We will call you'],
};
const presetsFor = (type: string): string[] => PRESETS_BY_TYPE[type] ?? PRESETS;
/** Water, electricity and AC problems are never turned down: the team fixes them, or passes them on. */
const NEVER_DECLINE = /\b(ac|a\/c|electric\w*|power|water|plumb\w*|light|fan|geyser)\b/i;
const mustFix = (r: { type: string; label: string }): boolean => r.type === 'help' && NEVER_DECLINE.test(r.label);
const OUTCOMES = [['fixed', 'Fixed'], ['replacement_sent', 'Replacement sent'], ['room_changed', 'Room changed'], ['compensation_offered', 'Compensation offered']] as const;
const OPEN = ['received', 'accepted', 'preparing', 'ready'];

const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

export function DeskApp({ role, hotel, title = 'Reception desk', current = 'desk', start = 'all' }: { role: string; hotel: string; title?: string; current?: NavCurrent; start?: Group }) {
  const privileged = role === 'owner' || role === 'manager';
  const [group, setGroup] = useState<Group>(start);
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [calls, setCalls] = useState<BoardRequest[]>([]);
  const [sessions, setSessions] = useState<BoardSession[]>([]);
  const [orderRoomDining, setOrderRoomDining] = useState(true);
  const seenOrders = useRef<Set<string>>(new Set());
  const firstOrders = useRef(true);
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = useCallback((ok: boolean, text: string) => setNote({ ok, text }), []);
  const sound = useRef(new AlertSound());
  const seen = useRef<Set<string>>(new Set());
  const first = useRef(true);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [b, a, ob] = await Promise.all([apiGet<{ requests: Req[]; me?: string }>('/api/padharosaa/v1/staff/board'), apiGet<Alerts>('/api/padharosaa/v1/staff/alerts'), apiGet<{ orders: BoardOrder[]; requests?: BoardRequest[]; sessions?: BoardSession[]; room_dining?: boolean }>('/api/staff/board').catch(() => null)]);
      setReqs(b.requests); setMe(b.me ?? null); setAlerts(a); setErr(null);
      if (ob) { setOrders(ob.orders ?? []); setCalls(ob.requests ?? []); setSessions(ob.sessions ?? []); setOrderRoomDining(ob.room_dining !== false); }
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) window.location.assign('/login?next=/padharosaa/desk');
      else if (e instanceof ApiFailure && e.status === 403) setErr('This restaurant is not a Padharosaa hotel yet. Please ask Taprizz to switch Padharosaa on for it, then reload this page.');
      else setErr('Could not reach the server. Retrying…');
    }
  }, []);
  useEffect(() => { void load(); const i = setInterval(() => { if (!document.hidden) void load(); tick((n) => n + 1); }, 4000); return () => clearInterval(i); }, [load]);

  const muted = useMemo(() => new Set(alerts?.muted ?? []), [alerts]);
  // reception, concierge, manager and owner hand requests to a person; the list of people is fetched once and refreshed when it is opened
  const canAssign = privileged || !!alerts?.teams.includes('front_desk') || !!alerts?.teams.includes('concierge');
  const loadPeople = useCallback(async () => { try { setPeople((await apiGet<{ people: Person[] }>('/api/padharosaa/v1/staff/assignees')).people); } catch { setPeople([]); } }, []);
  useEffect(() => { if (canAssign) void loadPeople(); }, [canAssign, loadPeople]);
  const allOpen = useMemo(() => (reqs ?? []).filter((r) => OPEN.includes(r.status) && (!mineOnly || r.assigned_to === me)), [reqs, mineOnly, me]);
  const doneToday = useMemo(() => (reqs ?? []).filter((r) => !OPEN.includes(r.status)).sort((a, b) => Date.parse(b.completed_at ?? b.created_at) - Date.parse(a.completed_at ?? a.created_at)), [reqs]);
  const mineCount = useMemo(() => (reqs ?? []).filter((r) => OPEN.includes(r.status) && r.assigned_to === me).length, [reqs, me]);
  const open = useMemo(() => { const t = privileged ? GROUP_TEAMS[group] : null; return t ? allOpen.filter((r) => t.includes(r.team)) : allOpen; }, [allOpen, group, privileged]);
  const pending = allOpen.filter((r) => r.status === 'received' && !muted.has(r.team));

  // each kind of request has its own sound (urgent siren, food chime, help ding-dong, housekeeping bell, waiter beeps); several kinds play one after another
  const playMany = (kinds: Parameters<AlertSound['play']>[0][]) => kinds.forEach((k, i) => setTimeout(() => sound.current.play(k), i * 1100));
  // alarm: once for each new request, and again every 20 seconds while something unmuted is still waiting
  useEffect(() => {
    if (!reqs) return;
    const fresh = pending.filter((r) => !seen.current.has(r.id));
    for (const r of reqs) seen.current.add(r.id);
    if (first.current) { first.current = false; return; }
    if (fresh.length) playMany(soundsFor(fresh));
  }, [reqs, pending]);
  useEffect(() => { if (!pending.length) return; const i = setInterval(() => playMany(soundsFor(pending)), 20000); return () => clearInterval(i); }, [pending]);

  // food orders ring the same alarm: once for each new order, and again every 20 seconds while one is still waiting
  const waitingOrders = orders.filter((o) => o.status === 'placed');
  useEffect(() => {
    const fresh = waitingOrders.filter((o) => !seenOrders.current.has(o.id));
    for (const o of orders) seenOrders.current.add(o.id);
    if (firstOrders.current) { firstOrders.current = false; return; }
    if (fresh.length && !muted.has('kitchen')) sound.current.play('order');
  }, [orders, waitingOrders, muted]);
  useEffect(() => { if (!waitingOrders.length || muted.has('kitchen')) return; const i = setInterval(() => sound.current.play('order'), 20000); return () => clearInterval(i); }, [waitingOrders.length, muted]);
  const seenCalls = useRef<Set<string>>(new Set());
  const firstCalls = useRef(true);
  useEffect(() => {
    const fresh = calls.filter((c) => !seenCalls.current.has(c.id));
    for (const c of calls) seenCalls.current.add(c.id);
    if (firstCalls.current) { firstCalls.current = false; return; }
    if (fresh.length) playMany(fresh.some((c) => c.type === 'bill') ? (fresh.some((c) => c.type === 'waiter') ? ['bill', 'waiter'] : ['bill']) : ['waiter']);
  }, [calls]);
  const orderAct = async (f: () => Promise<unknown>) => {
    try { await f(); setErr(null); } catch { setErr('That did not go through. Please try again.'); }
    await load();
  };
  const callActions: TableCallActions = {
    done: (r) => orderAct(() => apiPost('/api/staff/request-done', { request_id: r.id })),
    paid: (s, m) => orderAct(() => apiPost('/api/staff/close-session', { session_id: s.id, pay_mode: m })),
  };
  const orderActions: OrderDeskActions = {
    advance: (o, to) => orderAct(() => apiPost('/api/staff/order-status', { order_id: o.id, status: to })),
    cancel: (o, reason) => orderAct(() => apiPost('/api/staff/order-status', { order_id: o.id, status: 'cancelled', reason })),
    handover: (o, mode) => orderAct(() => apiPost('/api/staff/order-handover', { order_id: o.id, mode })),
    readyIn: (o, minutes) => orderAct(() => apiPost('/api/staff/order-ready-in', { order_id: o.id, minutes })),
  };

  const act = async (r: Req, action: string, body: Record<string, unknown> = {}) => {
    try { await apiPost(`/api/padharosaa/v1/staff/requests/${r.id}/${action}`, { version: r.version, ...body }); setErr(null); }
    catch (e) { setErr(e instanceof ApiFailure && e.status === 409 ? 'Someone else just changed this request. The screen has been refreshed.' : 'That did not go through. Please try again.'); }
    await load();
  };
  const toggleMute = async (team: Team) => { await apiPost('/api/padharosaa/v1/staff/alerts', { team, muted: !muted.has(team) }); await load(); };

  return (
    <div className="mx-auto min-h-dvh max-w-3xl bg-stone-50 px-4 pb-24 pt-4 text-stone-900">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-stone-500">{hotel}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1></div>
        <div className="flex flex-wrap gap-2"><ThemeToggle />
        <button type="button" className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm font-semibold ${soundOn ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white text-stone-900'}`} onClick={async () => setSoundOn(await sound.current.enable())} aria-pressed={soundOn}>{soundOn ? 'Alarm sound is ON' : 'Turn alarm sound on'}</button></div>
      </header>
      <AreaNav role={role} current={current} kitchenDisplay={!!alerts?.kitchen_display} />
      {privileged && (
        <div role="group" aria-label="Show requests of" className="mt-4 flex gap-6 overflow-x-auto border-b border-stone-200">
          {(Object.keys(GROUP_LABEL) as Group[]).map((g) => {
            const t = GROUP_TEAMS[g];
            const n = (t ? allOpen.filter((r) => t.includes(r.team)).length : allOpen.length) + (g === 'all' || g === 'kitchen' ? orders.length : 0) + (g === 'all' || g === 'reception' ? calls.length : 0);
            return <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`-mb-px min-h-11 shrink-0 border-b-2 px-0.5 text-sm font-semibold ${group === g ? 'border-indigo-900 text-indigo-950' : 'border-transparent text-stone-500'}`}>{GROUP_LABEL[g]} <span className={`ml-0.5 rounded-md px-1.5 py-0.5 text-xs ${group === g ? 'bg-indigo-900 text-white' : 'bg-stone-100 text-stone-700'}`}>{n}</span></button>;
          })}
        </div>
      )}
      {(mineCount > 0 || mineOnly) && (
        <div className="mt-3"><button type="button" aria-pressed={mineOnly} onClick={() => setMineOnly(!mineOnly)} className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${mineOnly ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white text-stone-900'}`}>Only mine ({mineCount})</button></div>
      )}
      {note && <p role={note.ok ? 'status' : 'alert'} className={`mt-3 rounded-xl p-3 text-sm font-semibold ${note.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{note.text}</p>}
      {err && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">{err}</p>}
      {(() => {
        // one list for everything: guest requests and food orders together, urgent first, then the longest-waiting first
        const orderGroup = privileged ? GROUP_TEAMS[group] : null;
        const shownOrders = orderGroup && group !== 'kitchen' ? [] : orders;
        const items = [
          ...open.map((r) => ({ key: `r${r.id}`, urgent: r.urgent, at: r.created_at, node: <Card key={`r${r.id}`} r={r} role={role} me={me} people={canAssign ? people : null} refreshPeople={loadPeople} roomDining={alerts?.room_dining ?? true} muted={muted.has(r.team)} act={act} /> })),
          ...(orderGroup && group !== 'all' && group !== 'reception' ? [] : calls).map((c) => ({ key: `c${c.id}`, urgent: false, at: c.created_at, node: <TableCallDesk key={`c${c.id}`} r={c} session={sessions.find((x) => x.id === c.session_id)} a={callActions} /> })),
          ...shownOrders.map((o) => ({ key: `o${o.id}`, urgent: false, at: o.created_at, node: <OrderCardDesk key={`o${o.id}`} o={o} role={role} roomDining={orderRoomDining} a={orderActions} /> })),
        ].sort((x, y) => Number(y.urgent) - Number(x.urgent) || new Date(x.at).getTime() - new Date(y.at).getTime());
        return (
          <>
            <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-[.16em] text-stone-500">Open · {items.length}</h2>
            {reqs && items.length === 0 && <p className="mt-2 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">All clear. New requests and food orders appear here by themselves.</p>}
            <ul className="mt-2 space-y-3">{items.map((x) => x.node)}</ul>
          </>
        );
      })()}
      <CheckoutPanel flash={flash} />
      <details className="mt-4 rounded-xl border border-stone-200 bg-white p-4" data-testid="stay-code-tool">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Stay code for a new guest</summary>
        <p className="mb-3 text-sm text-stone-600">If your hotel asks guests for a code, make it here at check-in and tell the guest.</p>
        <StayCodeTool flash={flash} />
      </details>
      {alerts && (
        <details aria-label="My alerts" className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">My alerts and alarm sounds <span className="text-sm font-normal text-stone-500">(only for me)</span></summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {alerts.teams.map((t) => <button key={t} type="button" aria-pressed={!muted.has(t)} onClick={() => void toggleMute(t)} className={`min-h-11 rounded-full border-2 px-3 text-sm font-semibold ${muted.has(t) ? 'border-stone-400 text-stone-700' : 'border-emerald-800 bg-emerald-50 text-emerald-950'}`}>{TEAM_NAME[t]}: {muted.has(t) ? 'muted' : 'on'}</button>)}
          </div>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-stone-700">Hear each alarm (turn the sound on first)</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {([['urgent', 'Urgent'], ['order', 'Food order'], ['help', 'Help'], ['housekeeping', 'Housekeeping'], ['waiter', 'Waiter call'], ['bill', 'Bill']] as const).map(([k, label]) => <button key={k} type="button" onClick={() => sound.current.play(k)} className="min-h-11 rounded-full border-2 border-stone-400 px-3 text-sm font-semibold text-stone-900">▶ {label}</button>)}
          </div>
        </details>
      )}
      {doneToday.length > 0 && (
        <details className="mt-4 rounded-xl border border-stone-200 bg-white p-4" data-testid="done-today">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">Done today <span className="text-sm font-semibold text-stone-700">({doneToday.length}, last 12 hours)</span></summary>
          <ul className="mt-1 divide-y divide-stone-200">
            {doneToday.map((r) => (
              <li key={r.id} className="py-2 text-sm"><b>Room {r.room}</b> · {r.label}
                <span className="ml-1 text-stone-700">· {r.status === 'completed' ? 'done' : r.status === 'dismissed' ? 'declined' : r.status}{r.assigned_name ? ` · ${r.assigned_name}` : ''} · {new Date(r.completed_at ?? r.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></li>
            ))}
          </ul>
        </details>
      )}
      {(privileged || alerts?.teams.includes('front_desk') || alerts?.teams.includes('concierge')) && (
        <details className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">Buffet and guest phone alerts</summary>
          <BuffetManager flash={flash} bare />
        </details>
      )}
    </div>
  );
}

function Card({ r, role, me, people, refreshPeople, roomDining, muted, act }: { r: Req; role: string; me: string | null; people: Person[] | null; refreshPeople: () => Promise<void>; roomDining: boolean; muted: boolean; act: (r: Req, a: string, b?: Record<string, unknown>) => Promise<void> }) {
  const [mode, setMode] = useState<null | 'decline' | 'pass' | 'resolve' | 'assign'>(null);
  const [reason, setReason] = useState('');
  const [more, setMore] = useState(false);
  const age = mins(r.created_at);
  const urgentCls = r.urgent ? '!border-l-red-700' : r.status === 'received' ? '!border-l-amber-500' : '!border-l-stone-300';
  const btn = 'min-h-11 rounded-lg px-4 text-sm font-semibold';
  return (
    <li className={`rounded-xl border border-l-4 border-stone-200 p-4 ${r.urgent ? 'bg-red-50/60' : 'bg-white'} ${urgentCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-lg font-semibold tracking-tight">Room {r.room} <span className="font-semibold text-stone-700">· {r.guest_name}</span></p>{r.mobile && <a href={`tel:${dialNumber(r.mobile)}`} className="text-sm font-semibold underline">{r.mobile}</a>}</div>
        <span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{age} min</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-xs font-bold">
        {r.urgent && <span className="rounded-full bg-red-800 px-2 py-1 text-white">URGENT</span>}
        <span className="rounded-full bg-stone-200 px-2 py-1">{TEAM_NAME[r.team]}</span>
        {r.diet && <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-950">{r.diet.replace('_', ' ')}</span>}
        {r.occasion && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-950">{r.occasion}</span>}
        {r.assigned_to && <span className={`rounded-full px-2 py-1 ${r.assigned_to === me ? 'bg-violet-800 text-white' : 'bg-violet-100 text-violet-950'}`}>{r.assigned_to === me ? 'Assigned to me' : `Assigned to ${r.assigned_name ?? 'someone'}`}</span>}
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
        {r.status === 'received' && <button type="button" className={`${btn} bg-indigo-900 text-white`} onClick={() => void act(r, 'accept')}>Accept</button>}
        {r.status !== 'received' && r.type !== 'help' && <button type="button" className={`${btn} bg-indigo-900 text-white`} onClick={() => void act(r, 'complete')}>Mark done</button>}
        {r.type === 'help' && <button type="button" className={`${btn} border border-indigo-900 text-indigo-950`} onClick={() => setMode(mode === 'resolve' ? null : 'resolve')}>Resolved…</button>}
        {people && r.type !== 'food' && <button type="button" className={`${btn} border border-stone-300 text-stone-900`} onClick={() => { setMode(mode === 'assign' ? null : 'assign'); void refreshPeople(); }}>{r.assigned_to ? 'Change person…' : 'Assign to…'}</button>}
        {((role !== 'kitchen' && r.type !== 'food') || (r.status !== 'preparing' && r.status !== 'ready' && !mustFix(r))) && <button type="button" aria-expanded={more} className={`${btn} border border-stone-300 text-stone-900`} onClick={() => setMore(!more)}>More {more ? '▴' : '▾'}</button>}
        {more && role !== 'kitchen' && r.type !== 'food' && <button type="button" className={`${btn} border border-stone-300 text-stone-900`} onClick={() => setMode(mode === 'pass' ? null : 'pass')}>Pass to team</button>}
        {more && r.status !== 'preparing' && r.status !== 'ready' && !mustFix(r) && <button type="button" className={`${btn} border border-red-300 text-red-800`} onClick={() => setMode(mode === 'decline' ? null : 'decline')}>Decline…</button>}
      </div>
      {mode === 'decline' && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 3) void act(r, 'dismiss', { reason: reason.trim() }); }}>
          <label className="block text-sm font-semibold">Reason or information for the guest (they will see this)
            <textarea required minLength={3} maxLength={140} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border-2 border-stone-300 p-2 text-base" />
          </label>
          <div className="flex flex-wrap gap-2">{presetsFor(r.type).map((p) => <button key={p} type="button" className="min-h-11 rounded-full bg-stone-100 px-3 text-sm font-semibold" onClick={() => setReason(p)}>{p}</button>)}</div>
          <button type="submit" disabled={reason.trim().length < 3} className={`${btn} bg-red-800 text-white disabled:opacity-50`}>Send to guest</button>
        </form>
      )}
      {mode === 'assign' && people && (
        <div className="mt-3" role="group" aria-label="Assign to a person">
          <div className="flex flex-wrap gap-2">
            {people.map((p) => <button key={p.user_id} type="button" aria-pressed={r.assigned_to === p.user_id} className={`${btn} ${r.assigned_to === p.user_id ? 'bg-violet-900 text-white' : 'bg-stone-100'}`} onClick={() => void act(r, 'assign', { user: p.user_id })}>{p.name}{p.department ? ` · ${TEAM_NAME[p.department as Team] ?? p.department}` : ''}</button>)}
            {r.assigned_to && <button type="button" className={`${btn} border border-stone-300 text-stone-900`} onClick={() => void act(r, 'assign', { user: null })}>Back to the team</button>}
          </div>
          {people.length === 0 && <p className="mt-2 text-sm text-stone-700">No team members yet. The owner or manager adds them in Manage → Team.</p>}
        </div>
      )}
      {mode === 'pass' && <div className="mt-3 flex flex-wrap gap-2">{(Object.keys(TEAM_NAME) as Team[]).filter((t) => t !== r.team).map((t) => <button key={t} type="button" className={`${btn} bg-stone-100`} onClick={() => void act(r, 'pass', { team: t })}>{TEAM_NAME[t]}</button>)}</div>}
      {mode === 'resolve' && <div className="mt-3 flex flex-wrap gap-2">{OUTCOMES.map(([k, l]) => <button key={k} type="button" className={`${btn} bg-stone-100`} onClick={() => void act(r, 'resolve', { outcome: k })}>{l}</button>)}</div>}
    </li>
  );
}
