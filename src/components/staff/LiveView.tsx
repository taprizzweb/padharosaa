'use client';
import { tableName } from '@/lib/rooms';
import { useState } from 'react';
import { formatPaise } from '@/lib/money';
import { counterInstruction } from '@/lib/pay';
import {
  WAITER_REASON_LABEL, closeOptions, formatAge, orderActions, waitSeverity,
  type BoardData, type BoardHelp, type BoardOrder, type BoardRequest, type BoardSession, type OrderAction, type Role, type Severity,
} from '@/lib/staff/logic';
import { Alert, IconBell, IconCheck, IconReceipt, Sheet, btnPrimary, btnSecondary } from '@/components/guest/ui';

const SEVERITY_STYLE: Record<Severity, string> = {
  ok: 'border-stone-300 bg-white',
  amber: 'border-amber-500 bg-amber-50',
  red: 'border-red-600 bg-red-50',
};
const SEVERITY_BADGE: Record<Exclude<Severity, 'ok'>, string> = {
  amber: 'bg-amber-200 text-amber-950',
  red: 'bg-red-200 text-red-950',
};
const actionBtn = (kind: OrderAction['kind']) =>
  kind === 'primary'
    ? 'inline-flex min-h-14 flex-1 items-center justify-center rounded-xl bg-stone-900 px-4 text-lg font-bold text-white disabled:opacity-60'
    : 'inline-flex min-h-14 items-center justify-center rounded-xl border-2 border-red-700 bg-white px-4 text-base font-bold text-red-800 disabled:opacity-60';

export interface Actions {
  advance: (orderId: string, to: OrderAction['to']) => void;
  handover: (orderId: string, mode: 'deliver' | 'takeaway') => void;
  cancel: (order: BoardOrder) => void;
  resolve: (requestId: string) => void;
  resolveHelp: (helpId: string) => void;
  close: (session: BoardSession) => void;
  busy: Set<string>;
}

function AgeBadge({ ageSeconds, sev }: { ageSeconds: number; sev: Severity }) {
  return (
    <span className="flex items-center gap-2 text-base font-bold tabular-nums">
      {sev !== 'ok' && <span className={`rounded-md px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide ${SEVERITY_BADGE[sev]}`}>{sev === 'amber' ? 'Late' : 'Very late'}</span>}
      <span>{formatAge(ageSeconds)}</span>
    </span>
  );
}

function OrderCard({ o, role, nowMs, amber, red, actions, roomDining }: { o: BoardOrder; role: Role; nowMs: number; amber: number; red: number; actions: Actions; roomDining: boolean }) {
  const age = (nowMs - Date.parse(o.created_at)) / 1000;
  const sev = waitSeverity(age, amber, red);
  const busy = actions.busy.has(o.id);
  return (
    <li data-testid={`order-${o.order_no}`} className={`rounded-2xl border-2 p-4 ${SEVERITY_STYLE[sev]}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-extrabold leading-none">{tableName(o.table_label)}</p>
          <p className="mt-1 text-sm font-semibold text-stone-700">Order #{o.order_no}</p>
        </div>
        <AgeBadge ageSeconds={age} sev={sev} />
      </div>
      <ul className="mt-3 space-y-1 text-lg">
        {o.items.map((it, i) => (
          <li key={i}>
            <span className="font-extrabold">{it.qty} ×</span> {it.name}
            {it.note && <span className="block text-base italic text-stone-700">“{it.note}”</span>}
          </li>
        ))}
      </ul>
      {o.note && <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-base font-semibold">Kitchen note: {o.note}</p>}
      {o.is_room && o.handover && (
        <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-base font-bold text-sky-950" data-testid="handover-note">
          {o.handover === 'deliver' ? 'Guest wants ROOM DELIVERY: accept it, or switch to Takeaway if you cannot deliver.' : `Guest will COLLECT it at the desk${o.handover_minutes ? ` in about ${o.handover_minutes} min` : ''}. Call their name when ready.`}
        </p>
      )}
      {o.is_room && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="How does this reach the guest?">
          {roomDining && <button type="button" disabled={busy} aria-pressed={o.handover === 'deliver'} className={`min-h-12 rounded-xl border-2 px-4 text-base font-bold ${o.handover === 'deliver' ? 'border-sky-900 bg-sky-900 text-white' : 'border-sky-900 bg-white text-sky-950'}`} onClick={() => actions.handover(o.id, 'deliver')}>Room delivery</button>}
          <button type="button" disabled={busy} aria-pressed={o.handover === 'takeaway'} className={`min-h-12 rounded-xl border-2 px-4 text-base font-bold ${o.handover === 'takeaway' ? 'border-sky-900 bg-sky-900 text-white' : 'border-sky-900 bg-white text-sky-950'}`} onClick={() => actions.handover(o.id, 'takeaway')}>Takeaway</button>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {orderActions(role, o.status).map((a) => (
          <button key={a.to} type="button" disabled={busy} className={actionBtn(a.kind)} onClick={() => (a.to === 'cancelled' ? actions.cancel(o) : actions.advance(o.id, a.to))}>
            {a.label}
          </button>
        ))}
      </div>
    </li>
  );
}

function RequestCard({ r, nowMs, actions }: { r: BoardRequest; nowMs: number; actions: Actions }) {
  const age = (nowMs - Date.parse(r.created_at)) / 1000;
  const bill = r.type === 'bill';
  return (
    <li data-testid={`request-${r.type}-${r.table_label}`} className={`rounded-2xl border-2 p-4 ${bill ? 'border-emerald-700 bg-emerald-50' : 'border-sky-700 bg-sky-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
            {bill ? <IconReceipt /> : <IconBell />} {bill ? 'Bill request' : 'Waiter call'}
          </p>
          <p className="mt-1 text-2xl font-extrabold leading-none">{tableName(r.table_label)}</p>
        </div>
        <span className="text-base font-bold tabular-nums">{formatAge(age)}</span>
      </div>
      <p className="mt-3 text-xl font-bold">
        {bill ? counterInstruction(r.pay_mode) : (WAITER_REASON_LABEL[r.reason ?? ''] ?? 'Needs help')}
      </p>
      <button type="button" disabled={actions.busy.has(r.id)} onClick={() => actions.resolve(r.id)} className={`${btnPrimary} mt-3 w-full !bg-stone-900`}>
        <IconCheck /> Done
      </button>
    </li>
  );
}

function HelpCard({ h, nowMs, actions }: { h: BoardHelp; nowMs: number; actions: Actions }) {
  const age = (nowMs - Date.parse(h.created_at)) / 1000;
  return (
    <li data-testid={`help-${h.room}`} className="rounded-2xl border-2 border-violet-800 bg-violet-50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-violet-950"><IconBell /> Guest problem</p>
          <p className="mt-1 text-2xl font-extrabold leading-none">{tableName(`Room ${h.room}`)}</p>
        </div>
        <span className="text-base font-bold tabular-nums">{formatAge(age)}</span>
      </div>
      {h.topics.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Problems">
          {h.topics.map((t) => <li key={t} className="rounded-lg bg-violet-900 px-3 py-1.5 text-base font-bold text-white">{t}</li>)}
        </ul>
      )}
      {h.note && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-base font-semibold">“{h.note}”</p>}
      <button type="button" disabled={actions.busy.has(h.id)} onClick={() => actions.resolveHelp(h.id)} className={`${btnPrimary} mt-3 w-full !bg-stone-900`}>
        <IconCheck /> Done
      </button>
    </li>
  );
}

function SessionCard({ s, role, nowMs, actions }: { s: BoardSession; role: Role; nowMs: number; actions: Actions }) {
  const opts = closeOptions(role, s);
  const open = formatAge((nowMs - Date.parse(s.opened_at)) / 1000);
  return (
    <li data-testid={`table-${s.table_label}`} className="rounded-2xl border-2 border-stone-300 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-extrabold leading-none">{tableName(s.table_label)}</p>
          <p className="mt-1 text-sm text-stone-700">Open {open} · {s.orders_count} {s.orders_count === 1 ? 'order' : 'orders'}</p>
        </div>
        <p className="text-2xl font-extrabold tabular-nums">{formatPaise(s.total_paise)}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm font-bold">
        {s.bill_requested_at && <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-950">Bill requested{s.pay_mode ? ` · ${s.pay_mode.toUpperCase()}` : ''}</span>}
        {s.unserved_count > 0 && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-950">{s.unserved_count} not served</span>}
      </div>
      {opts.blockedReason && <p className="mt-2 text-sm text-stone-700">{opts.blockedReason}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!opts.canPay && !opts.canForce} onClick={() => actions.close(s)} className={`${btnPrimary} w-full !bg-stone-900`}>
          {opts.canPay ? opts.payLabel : opts.canForce ? 'Force close…' : opts.payLabel}
        </button>
      </div>
    </li>
  );
}

export function LiveView({ board, role, nowMs, amber, red, actions }: { board: BoardData | null; role: Role; nowMs: number; amber: number; red: number; actions: Actions }) {
  if (!board) return <p className="py-16 text-center text-lg text-stone-700">Loading the live board…</p>;
  const cols: { title: string; status: BoardOrder['status']; empty: string }[] = [
    { title: 'New', status: 'placed', empty: 'No new orders' },
    { title: 'Preparing', status: 'preparing', empty: 'Nothing cooking' },
    { title: 'Ready to serve', status: 'ready', empty: 'Nothing waiting' },
  ];
  return (
    <div className="space-y-8">
      {role !== 'kitchen' && (board.help?.length ?? 0) > 0 && (
        <section aria-labelledby="help-h">
          <h2 id="help-h" className="mb-3 flex items-center gap-2 text-xl font-extrabold">
            Guest problems <span className="rounded-full bg-violet-900 px-2.5 py-0.5 text-sm text-white">{board.help!.length}</span>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {board.help!.map((h) => <HelpCard key={h.id} h={h} nowMs={nowMs} actions={actions} />)}
          </ul>
        </section>
      )}

      {role !== 'kitchen' && (
        <section aria-labelledby="calls-h">
          <h2 id="calls-h" className="mb-3 flex items-center gap-2 text-xl font-extrabold">
            Calls &amp; bills <span className="rounded-full bg-stone-900 px-2.5 py-0.5 text-sm text-white">{board.requests.length}</span>
          </h2>
          {board.requests.length === 0 ? (
            <p className="text-stone-700">No one is calling right now.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {board.requests.map((r) => <RequestCard key={r.id} r={r} nowMs={nowMs} actions={actions} />)}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="orders-h">
        <h2 id="orders-h" className="mb-3 text-xl font-extrabold">Orders</h2>
        <div className="grid gap-5 md:grid-cols-3">
          {cols.map((c) => {
            const list = board.orders.filter((o) => o.status === c.status);
            return (
              <div key={c.status}>
                <h3 className="mb-2 flex items-center gap-2 text-base font-extrabold uppercase tracking-wide text-stone-800">
                  {c.title} <span className="rounded-full bg-stone-200 px-2 py-0.5 text-sm">{list.length}</span>
                </h3>
                {list.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-4 text-stone-600">{c.empty}</p> : (
                  <ul className="space-y-3">{list.map((o) => <OrderCard key={o.id} o={o} role={role} nowMs={nowMs} amber={amber} red={red} actions={actions} roomDining={board.room_dining !== false} />)}</ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {role !== 'kitchen' && (
        <section aria-labelledby="tables-h">
          <h2 id="tables-h" className="mb-3 flex items-center gap-2 text-xl font-extrabold">
            Open tables <span className="rounded-full bg-stone-900 px-2.5 py-0.5 text-sm text-white">{board.sessions.length}</span>
          </h2>
          {board.sessions.length === 0 ? <p className="text-stone-700">No tables are open.</p> : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {board.sessions.map((s) => <SessionCard key={s.id} s={s} role={role} nowMs={nowMs} actions={actions} />)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

const QUICK_CANCEL = ['Guest changed their mind', 'Sold out', 'Wrong table', 'Duplicate order'];

export function CancelDialog({ order, onClose, onConfirm, busy, error }: { order: BoardOrder | null; onClose: () => void; onConfirm: (reason: string) => void; busy: boolean; error: string | null }) {
  const [reason, setReason] = useState('');
  return (
    <Sheet open={!!order} onClose={() => { setReason(''); onClose(); }} title={order ? `Cancel order #${order.order_no}?` : 'Cancel order'} closeLabel="Close">
      {order && (
        <div className="space-y-4">
          <p className="text-stone-800">{tableName(order.table_label)} will be told this order was cancelled, with your reason.</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_CANCEL.map((q) => (
              <button key={q} type="button" onClick={() => setReason(q)} className={`${btnSecondary} ${reason === q ? '!border-stone-900 !bg-stone-900 !text-white' : ''}`}>{q}</button>
            ))}
          </div>
          <label className="block text-sm font-semibold">
            Reason (required)
            <input type="text" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-stone-300 px-3 text-base font-normal" />
          </label>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={`${btnSecondary} min-h-12 flex-1`}>Keep order</button>
            <button type="button" disabled={busy || reason.trim().length === 0} onClick={() => onConfirm(reason.trim())} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-red-700 px-4 text-base font-bold text-white disabled:opacity-60">
              Cancel order
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function CloseDialog({ session, role, onClose, onConfirm, busy, error }: {
  session: BoardSession | null; role: Role; onClose: () => void; busy: boolean; error: string | null;
  onConfirm: (opts: { force: boolean; reason?: string; payMode?: 'cash' | 'upi' | 'card' }) => void;
}) {
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'cash' | 'upi' | 'card' | null>(null);
  if (!session) return <Sheet open={false} onClose={onClose} title="" closeLabel="Close">{null}</Sheet>;
  const opts = closeOptions(role, session);
  const force = !opts.canPay && opts.canForce;
  const chosen = mode ?? session.pay_mode;
  const title = force ? `Force close ${tableName(session.table_label)}?` : session.total_paise > 0 ? `Mark ${tableName(session.table_label)} as paid?` : `Close ${tableName(session.table_label)}?`;
  return (
    <Sheet open onClose={() => { setReason(''); setMode(null); onClose(); }} title={title} closeLabel="Close">
      <div className="space-y-4">
        <p className="text-3xl font-extrabold tabular-nums">{formatPaise(session.total_paise)}</p>
        {force ? (
          <>
            <p className="text-stone-800">{opts.blockedReason}</p>
            <label className="block text-sm font-semibold">
              Reason (required)
              <input type="text" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-stone-300 px-3 text-base font-normal" />
            </label>
          </>
        ) : (
          <>
            <p className="text-stone-800">{session.total_paise > 0 ? 'The guest will see the thank-you screen and this table will be free for the next group.' : 'Nothing was ordered. The table will be free for the next group.'}</p>
            {session.total_paise > 0 && (
              <div role="group" aria-label="Paid with" className="flex gap-2">
                {(['cash', 'upi', 'card'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={chosen === m} onClick={() => setMode(m)} className={`${btnSecondary} flex-1 ${chosen === m ? '!border-stone-900 !bg-stone-900 !text-white' : ''}`}>
                    {m === 'upi' ? 'UPI' : m[0]!.toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`${btnSecondary} min-h-12 flex-1`}>Go back</button>
          <button
            type="button"
            disabled={busy || (force && reason.trim().length === 0)}
            onClick={() => onConfirm({ force, reason: reason.trim() || undefined, payMode: chosen ?? undefined })}
            className={`inline-flex min-h-12 flex-1 items-center justify-center rounded-xl px-4 text-base font-bold text-white disabled:opacity-60 ${force ? 'bg-red-700' : 'bg-stone-900'}`}
          >
            {force ? 'Force close table' : session.total_paise > 0 ? 'Confirm paid' : 'Close table'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
