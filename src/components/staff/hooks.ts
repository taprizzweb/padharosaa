'use client';
import { createBrowserClient } from '@supabase/ssr';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiFailure } from '@/lib/guest/client';
import { ALERT_REPEAT_MS, REALTIME_TABLES, activeKinds, newKinds, pendingAlerts, realtimeChannel, realtimeFilter, toSets, type AlertKind, type BoardData, type Role } from '@/lib/staff/logic';
import { AlertSound } from './sound';

const POLL_FALLBACK_MS = 5000; // when realtime is down (or not connected yet)
const POLL_RECONCILE_MS = 30000; // safety net while realtime is healthy

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new ApiFailure('network', 0);
  }
  const body = (await res.json().catch(() => null)) as { error?: { key?: string }; requestId?: string } | null;
  if (!res.ok) {
    if (res.status === 403 && body?.error?.key === 'mfa_required') window.location.assign('/account/mfa?next=/staff');
    throw new ApiFailure(body?.error?.key ?? 'server_error', res.status, body?.requestId);
  }
  return body as T;
}
export const apiGet = <T,>(path: string) => api<T>(path);
export const apiPost = <T,>(path: string, data: unknown) => api<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

/** Signed-out (session expired) => back to the sign-in page. */
export function handleAuthFailure(e: unknown): boolean {
  if (e instanceof ApiFailure && e.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    return true;
  }
  return false;
}

export interface LiveBoard {
  board: BoardData | null;
  /** milliseconds to add to this device's clock to get server time (waiting times never trust the tablet's clock) */
  clockOffsetMs: number;
  /** server time right now, ticking every second */
  serverNowMs: number;
  lastUpdated: Date | null;
  /** true when the last fetches failed or are too old: shows the loud "Connection lost" banner */
  connectionLost: boolean;
  refresh: () => void;
}

/** Live board: refetched on every realtime hint, polled every 5 s when realtime is down, with a visible lost-connection state. */
export function useBoard(realtimeUp: boolean): LiveBoard & { hint: () => void } {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [offset, setOffset] = useState(0);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [failures, setFailures] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const up = useRef(realtimeUp);
  up.current = realtimeUp;
  const run = useRef<() => void>(() => undefined);

  run.current = async () => {
    clearTimeout(timer.current);
    if (!inflight.current) {
      inflight.current = true;
      try {
        const b = await apiGet<BoardData>('/api/staff/board');
        setBoard(b);
        setOffset(Date.parse(b.server_time) - Date.now());
        setLastOk(Date.now());
        setFailures(0);
      } catch (e) {
        if (!handleAuthFailure(e)) setFailures((n) => n + 1);
      } finally {
        inflight.current = false;
      }
    }
    timer.current = setTimeout(() => run.current(), up.current ? POLL_RECONCILE_MS : POLL_FALLBACK_MS);
  };

  useEffect(() => {
    run.current();
    const wake = () => run.current();
    const vis = () => !document.hidden && wake();
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', vis);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(timer.current);
      clearTimeout(debounce.current);
      clearInterval(tick);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  const hint = useCallback(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => run.current(), 250);
  }, []);

  const connectionLost = failures >= 2 || (lastOk !== null && now - lastOk > 15000 + (up.current ? POLL_RECONCILE_MS : 0));
  return { board, clockOffsetMs: offset, serverNowMs: now + offset, lastUpdated: lastOk ? new Date(lastOk) : null, connectionLost, refresh: () => run.current(), hint };
}

/**
 * Supabase Realtime (row-level-security protected) as a speed-up: any change to this restaurant's orders, requests or
 * tables nudges an immediate refetch. If it is down, polling alone keeps the screen correct.
 */
export function useRealtimeHint(cfg: { url: string; anonKey: string; restaurantId: string }, onChange: () => void): boolean {
  const [up, setUp] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let closed = false;
    const sb = createBrowserClient(cfg.url, cfg.anonKey);
    const filter = realtimeFilter(cfg.restaurantId);
    const channel = sb.channel(realtimeChannel(cfg.restaurantId));
    for (const table of REALTIME_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => cb.current());
    }
    sb.auth
      .getSession()
      .then(({ data }) => {
        if (closed) return;
        if (data.session) sb.realtime.setAuth(data.session.access_token);
        channel.subscribe((status) => !closed && setUp(status === 'SUBSCRIBED'));
      })
      .catch(() => undefined);
    return () => {
      closed = true;
      void sb.removeChannel(channel);
    };
  }, [cfg.url, cfg.anonKey, cfg.restaurantId]);
  return up;
}

export interface Alerts {
  soundOn: boolean;
  enableSound: () => Promise<void>;
}

/** Plays a tone when something new needs attention, and repeats every 6 s until it is acknowledged (accepted / resolved). */
export function useAlerts(board: BoardData | null, role: Role): Alerts {
  const sound = useMemo(() => new AlertSound(), []);
  const [soundOn, setSoundOn] = useState(false);
  const prev = useRef<ReturnType<typeof toSets> | null>(null);
  const pending = useRef<Record<AlertKind, string[]>>({ order: [], waiter: [], bill: [], help: [] });
  const repeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const playKinds = useCallback((kinds: AlertKind[]) => {
    kinds.forEach((k, i) => setTimeout(() => sound.play(k), i * 900));
  }, [sound]);

  useEffect(() => {
    if (!board) return;
    const p = pendingAlerts(board, role);
    pending.current = p;
    const fresh = newKinds(prev.current, p);
    prev.current = toSets(p);
    if (soundOn && fresh.length) playKinds(fresh);
    const any = activeKinds(p).length > 0;
    if (any && !repeat.current) {
      repeat.current = setInterval(() => {
        const kinds = activeKinds(pending.current);
        if (kinds.length === 0) {
          clearInterval(repeat.current);
          repeat.current = undefined;
        } else if (sound.ready) playKinds(kinds);
      }, ALERT_REPEAT_MS);
    }
    if (!any && repeat.current) {
      clearInterval(repeat.current);
      repeat.current = undefined;
    }
  }, [board, role, soundOn, sound, playKinds]);

  useEffect(() => () => clearInterval(repeat.current), []);

  const enableSound = useCallback(async () => {
    const ok = await sound.enable();
    setSoundOn(ok);
    // announce whatever is already waiting once sound is switched on
    if (ok) setTimeout(() => playKinds(activeKinds(pending.current)), 900);
  }, [sound, playKinds]);

  return { soundOn, enableSound };
}

/** Keeps the tablet screen awake while the staff screen is open (re-acquired when the tab becomes visible again). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) void l.release();
        else lock = l;
      } catch {
        /* not allowed (battery saver, background): the next visibility change retries */
      }
    };
    void acquire();
    const vis = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', vis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', vis);
      void lock?.release();
    };
  }, [active]);
}
