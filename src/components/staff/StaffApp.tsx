'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '@/lib/guest/client';
import { errorMessageKey, t } from '@/lib/i18n';
import type { BoardOrder, BoardSession, Role } from '@/lib/staff/logic';
import { Alert, IconBell, Sheet, btnSecondary } from '@/components/guest/ui';
import { CancelDialog, CloseDialog, LiveView, type Actions } from './LiveView';
import { SoldOutView } from './SoldOutView';
import { apiPost, handleAuthFailure, useAlerts, useBoard, useRealtimeHint, useWakeLock } from './hooks';

export interface StaffMe {
  user_id: string;
  role: Role;
  display_name: string;
  restaurant: { id: string; name: string; slug: string; status: string; accent: string; amber_minutes: number; red_minutes: number };
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', waiter: 'Waiter', kitchen: 'Kitchen' };
const LARGE_KEY = 'gm:staff:large';

const fmtClock = (d: Date) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(d);
const errText = (e: unknown) => t(errorMessageKey(e instanceof ApiFailure ? (e.status === 0 ? 'network' : e.key) : 'server_error'));

export function StaffApp({ me, supabase }: { me: StaffMe; supabase: { url: string; anonKey: string } }) {
  const [tab, setTab] = useState<'live' | 'soldout'>('live');
  const [cancelOrder, setCancelOrder] = useState<BoardOrder | null>(null);
  const [closeSession, setCloseSession] = useState<BoardSession | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [dialogBusy, setDialogBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [large, setLarge] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [realtimeUp, setRealtimeUp] = useState(false);
  const live = useBoard(realtimeUp);
  const up = useRealtimeHint({ url: supabase.url, anonKey: supabase.anonKey, restaurantId: me.restaurant.id }, live.hint);
  useEffect(() => setRealtimeUp(up), [up]);
  const alerts = useAlerts(live.board, me.role);
  useWakeLock(true);

  const suspended = me.restaurant.status !== 'active';

  useEffect(() => {
    try {
      const on = window.localStorage.getItem(LARGE_KEY) === '1';
      setLarge(on);
      document.documentElement.classList.toggle('staff-large', on);
    } catch {
      /* storage blocked */
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    return () => document.documentElement.classList.remove('staff-large');
  }, []);

  const toggleLarge = () => {
    const next = !large;
    setLarge(next);
    document.documentElement.classList.toggle('staff-large', next);
    try {
      window.localStorage.setItem(LARGE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  /** Runs a staff action, then refreshes the board; shows a plain-English error instead of failing silently. */
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, onError?: (m: string) => void) => {
      setBusy((b) => new Set(b).add(key));
      setToast(null);
      try {
        await fn();
        live.refresh();
        return true;
      } catch (e) {
        if (handleAuthFailure(e)) return false;
        (onError ?? setToast)(errText(e));
        live.refresh();
        return false;
      } finally {
        setBusy((b) => {
          const n = new Set(b);
          n.delete(key);
          return n;
        });
      }
    },
    [live],
  );

  const actions: Actions = {
    busy,
    advance: (id, to) => void run(id, () => apiPost('/api/staff/order-status', { order_id: id, status: to })),
    handover: (id, mode) => void run(id, () => apiPost('/api/staff/order-handover', { order_id: id, mode })),
    cancel: (o) => {
      setDialogError(null);
      setCancelOrder(o);
    },
    resolve: (id) => void run(id, () => apiPost('/api/staff/request-done', { request_id: id })),
    resolveHelp: (id) => void run(id, () => apiPost('/api/staff/help-done', { help_id: id })),
    close: (s) => {
      setDialogError(null);
      setCloseSession(s);
    },
  };

  const signOut = async (scope: 'local' | 'global') => {
    setSigningOut(true);
    try {
      await apiPost('/api/auth/logout', { scope });
    } finally {
      window.location.assign('/login');
    }
  };

  const tabBtn = (id: 'live' | 'soldout', label: string) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`min-h-12 rounded-xl px-5 text-base font-extrabold ${tab === id ? 'bg-stone-900 text-white' : 'bg-white text-stone-900 border-2 border-stone-300'}`}>
      {label}
    </button>
  );

  return (
    <div data-accent={me.restaurant.accent} className="min-h-dvh pb-16">
      <header className="sticky top-0 z-30 bg-stone-900 text-white">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-extrabold">{me.restaurant.name}</h1>
            <p className="text-sm text-stone-300">{ROLE_LABEL[me.role]} · {me.display_name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-stone-300" aria-live="off">
              {live.lastUpdated ? `Updated ${fmtClock(live.lastUpdated)}` : 'Connecting…'}
            </span>
            {alerts.soundOn ? (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-emerald-800 px-3 text-sm font-bold"><IconBell /> Sound on</span>
            ) : null}
            <button type="button" onClick={toggleLarge} aria-pressed={large} className="min-h-11 min-w-11 rounded-xl border border-stone-500 px-3 text-sm font-extrabold" aria-label="Larger text">
              A+
            </button>
            <button type="button" onClick={() => setMenu(true)} className="min-h-11 rounded-xl border border-stone-500 px-4 text-sm font-bold">Account</button>
          </div>
        </div>
      </header>

      {live.connectionLost && (
        <div role="alert" className="bg-red-700 px-4 py-3 text-center text-lg font-extrabold text-white">
          Connection lost. Showing the last known orders. Reconnecting…
        </div>
      )}
      {suspended && (
        <div role="alert" className="bg-amber-200 px-4 py-3 text-center text-base font-bold text-amber-950">
          This restaurant is suspended: guests cannot order and changes are blocked. Please contact support.
        </div>
      )}
      {!alerts.soundOn && (
        <div className="bg-amber-100 px-4 py-3">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3">
            <p className="text-base font-bold text-amber-950">Sound is off. You will not hear new orders, calls or bill requests.</p>
            <button type="button" onClick={() => void alerts.enableSound()} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-stone-900 px-5 text-base font-extrabold text-white">
              <IconBell /> Enable sound
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-screen-2xl px-4 pt-4">
        <div role="tablist" aria-label="Staff screens" className="mb-5 flex gap-2">
          {tabBtn('live', 'Live')}
          {tabBtn('soldout', 'Sold out')}
        </div>
        {toast && <div className="mb-4"><Alert>{toast}</Alert></div>}
        <main>
          {tab === 'live' ? (
            <LiveView board={live.board} role={me.role} nowMs={live.serverNowMs} amber={me.restaurant.amber_minutes} red={me.restaurant.red_minutes} actions={actions} />
          ) : (
            <SoldOutView />
          )}
        </main>
      </div>

      <CancelDialog
        order={cancelOrder}
        busy={dialogBusy}
        error={dialogError}
        onClose={() => setCancelOrder(null)}
        onConfirm={async (reason) => {
          if (!cancelOrder) return;
          setDialogBusy(true);
          const ok = await run(cancelOrder.id, () => apiPost('/api/staff/order-status', { order_id: cancelOrder.id, status: 'cancelled', reason }), setDialogError);
          setDialogBusy(false);
          if (ok) setCancelOrder(null);
        }}
      />
      <CloseDialog
        session={closeSession}
        role={me.role}
        busy={dialogBusy}
        error={dialogError}
        onClose={() => setCloseSession(null)}
        onConfirm={async ({ force, reason, payMode }) => {
          if (!closeSession) return;
          setDialogBusy(true);
          const ok = await run(closeSession.id, () => apiPost('/api/staff/close-session', { session_id: closeSession.id, force, reason, pay_mode: payMode }), setDialogError);
          setDialogBusy(false);
          if (ok) setCloseSession(null);
        }}
      />
      <Sheet open={menu} onClose={() => setMenu(false)} title="Account" closeLabel="Close">
        <div className="space-y-3">
          <p className="text-stone-800">Signed in as <strong>{me.display_name}</strong> ({ROLE_LABEL[me.role]}).</p>
          {(me.role === 'owner' || me.role === 'manager') && (
            <Link href="/dash/menu" prefetch={false} className={`${btnSecondary} min-h-12 w-full`}>Open dashboard</Link>
          )}
          <button type="button" disabled={signingOut} onClick={() => void signOut('local')} className={`${btnSecondary} min-h-12 w-full`}>Sign out</button>
          <button type="button" disabled={signingOut} onClick={() => void signOut('global')} className={`${btnSecondary} min-h-12 w-full`}>Sign out of all devices</button>
        </div>
      </Sheet>
    </div>
  );
}
