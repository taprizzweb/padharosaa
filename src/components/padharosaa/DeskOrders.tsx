'use client';

import { useState } from 'react';
import { formatPaise } from '@/lib/money';
import { orderActions, type BoardOrder, type BoardRequest, type BoardSession, type Role } from '@/lib/staff/logic';

const READY_IN = [5, 10, 15, 20, 30, 45];
const CANCEL_REASONS = ['Guest changed their mind', 'Sold out', 'Duplicate order', 'Wrong room'];
const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export interface OrderDeskActions {
  advance: (o: BoardOrder, to: 'preparing' | 'ready' | 'served') => Promise<void>;
  cancel: (o: BoardOrder, reason: string) => Promise<void>;
  handover: (o: BoardOrder, mode: 'deliver' | 'takeaway') => Promise<void>;
  readyIn: (o: BoardOrder, minutes: number) => Promise<void>;
}

/** A food order on the desk: the same card for room delivery and takeaway. The desk says when a takeaway will be ready; the guest answers how long they will take. */
export function OrderCardDesk({ o, role, roomDining, a }: { o: BoardOrder; role: string; roomDining: boolean; a: OrderDeskActions }) {
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); try { await f(); } finally { setBusy(false); } };
  const btn = 'min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-60';
  const waiting = o.status === 'placed';
  const takeaway = o.handover === 'takeaway';
  const readyAt = o.handover_minutes && o.ready_in_at ? new Date(new Date(o.ready_in_at).getTime() + o.handover_minutes * 60_000) : null;
  const replied = o.guest_eta_minutes !== null && o.guest_eta_minutes !== undefined;
  return (
    <li className={`rounded-2xl border-l-8 bg-white p-4 shadow-sm ${waiting ? 'border-amber-600' : 'border-stone-300'}`} data-testid="order-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-extrabold">{o.table_label} <span className="font-semibold text-stone-700">· Order #{o.order_no}</span></p>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-bold">{mins(o.created_at)} min</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-xs font-bold">
        <span className="rounded-full bg-orange-100 px-2 py-1 text-orange-950">FOOD ORDER</span>
        <span className="rounded-full bg-stone-200 px-2 py-1">{o.status === 'placed' ? 'Waiting' : o.status === 'preparing' ? 'Being prepared' : 'Ready'}</span>
        {o.handover && <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-950">{o.handover === 'deliver' ? 'Room delivery' : 'Takeaway'}</span>}
      </div>
      <ul className="mt-2 space-y-1 text-base">
        {o.items.map((it, i) => (
          <li key={i}><span className="font-extrabold">{it.qty} ×</span> {it.name}{it.note && <span className="block text-sm italic text-stone-700">“{it.note}”</span>}</li>
        ))}
      </ul>
      {o.note && <p className="mt-2 rounded-lg bg-stone-100 px-3 py-2 text-sm font-semibold">Kitchen note: {o.note}</p>}

      {o.is_room && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="How does this reach the guest?">
          {roomDining && <button type="button" disabled={busy} aria-pressed={o.handover === 'deliver'} className={`${btn} ${o.handover === 'deliver' ? 'bg-sky-900 text-white' : 'border-2 border-sky-900 text-sky-950'}`} onClick={() => void run(() => a.handover(o, 'deliver'))}>Room delivery</button>}
          <button type="button" disabled={busy} aria-pressed={o.handover === 'takeaway'} className={`${btn} ${o.handover === 'takeaway' ? 'bg-sky-900 text-white' : 'border-2 border-sky-900 text-sky-950'}`} onClick={() => void run(() => a.handover(o, 'takeaway'))}>Takeaway</button>
        </div>
      )}
      {o.is_room && o.handover === 'deliver' && waiting && <p className="mt-2 text-sm font-semibold text-sky-950">Guest wants room delivery. Accept it, or switch to Takeaway if you cannot deliver (the guest is told).</p>}

      {takeaway && (
        <div className="mt-3 space-y-2 rounded-xl bg-sky-50 p-3" data-testid="takeaway-box">
          <p className="text-sm font-bold text-sky-950">{readyAt ? `You told the guest: ready in ${o.handover_minutes} min (about ${clock(readyAt.toISOString())}).` : 'Tell the guest when the food will be ready:'}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Ready in">
            {READY_IN.map((n) => (
              <button key={n} type="button" disabled={busy} aria-pressed={o.handover_minutes === n} className={`${btn} ${o.handover_minutes === n ? 'bg-sky-900 text-white' : 'border-2 border-sky-900 bg-white text-sky-950'}`}
                onClick={() => void run(async () => { if (waiting) await a.advance(o, 'preparing'); await a.readyIn(o, n); })}>{n} min</button>
            ))}
          </div>
          {readyAt && (
            <p className={`text-sm font-bold ${replied ? 'text-emerald-900' : 'text-stone-700'}`} data-testid="guest-reply">
              {replied ? (o.guest_eta_minutes === 0 ? 'Guest replied: I am here now. Call their name.' : `Guest replied: will reach the desk in ${o.guest_eta_minutes} min.`) : 'Waiting for the guest to say how long they will take.'}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {orderActions(role as Role, o.status).filter((x) => x.to !== 'cancelled').map((x) => (
          <button key={x.to} type="button" disabled={busy} className={`${btn} bg-emerald-800 text-white`} onClick={() => void run(() => a.advance(o, x.to as 'preparing' | 'ready' | 'served'))}>{x.label}</button>
        ))}
        {orderActions(role as Role, o.status).some((x) => x.to === 'cancelled') && <button type="button" className={`${btn} border-2 border-red-800 text-red-900`} onClick={() => setCancelling(!cancelling)}>Cancel…</button>}
      </div>
      {cancelling && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Why is it cancelled?">
          {CANCEL_REASONS.map((r) => <button key={r} type="button" disabled={busy} className="min-h-11 rounded-full bg-stone-100 px-3 text-sm font-semibold" onClick={() => void run(() => a.cancel(o, r))}>{r}</button>)}
        </div>
      )}
    </li>
  );
}

export interface TableCallActions {
  done: (r: BoardRequest) => Promise<void>;
  paid: (s: BoardSession, mode: 'cash' | 'upi' | 'card') => Promise<void>;
}

/** A guest asked a waiter to come, or asked for the bill (the menu app's calls). They arrive on the same desk list as everything else. */
export function TableCallDesk({ r, session, a }: { r: BoardRequest; session: BoardSession | undefined; a: TableCallActions }) {
  const bill = r.type === 'bill';
  const mode = r.pay_mode ?? session?.pay_mode ?? null;
  const btn = 'min-h-11 rounded-xl px-4 text-sm font-bold';
  return (
    <li data-testid="table-call" className={`rounded-2xl border-l-8 bg-white p-4 shadow-sm ${bill ? 'border-violet-700' : 'border-amber-600'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-extrabold">{r.table_label}</p>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-bold">{mins(r.created_at)} min</span>
      </div>
      <p className="mt-1 text-base font-semibold">{bill ? 'Asked for the bill' : 'Asked for a waiter'}{bill && mode ? ` · pays by ${mode === 'upi' ? 'UPI' : mode}` : ''}</p>
      {bill && session && <p className="text-sm text-stone-700">Total {formatPaise(session.total_paise)} · {session.orders_count} order(s){session.unserved_count ? ` · ${session.unserved_count} not served yet` : ''}</p>}
      {r.reason && <p className="text-sm text-stone-700">For: {r.reason}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {bill && session && session.unserved_count === 0 && (['cash', 'upi', 'card'] as const).map((m) => <button key={m} type="button" className={`${btn} ${mode === m ? 'bg-emerald-800 text-white' : 'border-2 border-emerald-800 text-emerald-950'}`} onClick={() => void a.paid(session, m)}>Paid by {m === 'upi' ? 'UPI' : m}</button>)}
        <button type="button" className={`${btn} border-2 border-stone-700`} onClick={() => void a.done(r)}>{bill ? 'Bill given' : 'Done'}</button>
      </div>
    </li>
  );
}
