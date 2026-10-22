'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartLine, MenuItem, StatusData } from '@/lib/guest/types';
import { ApiFailure, fetchStatus } from '@/lib/guest/client';
import { lineKey, unitPrice } from '@/lib/guest/options';
import { readJson, remove, writeJson } from '@/lib/guest/storage';

const MAX_QTY = 10;

interface StoredCart {
  v: 1;
  lines: CartLine[];
  note: string;
}

export interface Cart {
  lines: CartLine[];
  note: string;
  ready: boolean;
  /** true once after lines were dropped because dishes sold out or disappeared */
  adjusted: boolean;
  count: number;
  totalPaise: number;
  /** how many of a dish are in the cart, over all its sizes and option choices */
  qtyOf(itemId: string): number;
  /** a plain dish (no sizes or options) */
  add(itemId: string): void;
  /** a dish with a chosen size and / or options */
  addConfigured(itemId: string, variantId: string | undefined, optionIds: string[], qty: number): void;
  setQty(lineId: string, qty: number): void;
  setLineNote(lineId: string, note: string): void;
  setNote(note: string): void;
  clear(): void;
  dismissAdjusted(): void;
}

/** Cart persisted in localStorage per restaurant; re-validated against the live menu so stale dishes, sizes or options never get sent. */
export function useCart(slug: string, items: Map<string, MenuItem>): Cart {
  const key = `gm:cart:${slug}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');
  const [ready, setReady] = useState(false);
  const [adjusted, setAdjusted] = useState(false);

  // Load once on the client (never during server render, to avoid a hydration mismatch).
  useEffect(() => {
    const stored = readJson<StoredCart>(key);
    if (stored?.v === 1 && Array.isArray(stored.lines)) {
      setLines(
        stored.lines
          .filter((l) => l && typeof l.id === 'string' && Number.isInteger(l.qty))
          .map((l) => ({ ...l, item_id: typeof l.item_id === 'string' ? l.item_id : l.id })),
      );
      setNote(typeof stored.note === 'string' ? stored.note : '');
    }
    setReady(true);
  }, [key]);

  // Drop lines whose dish, size or options are gone or sold out, clamp quantities.
  useEffect(() => {
    if (!ready) return;
    setLines((cur) => {
      const next = cur
        .filter((l) => {
          const item = items.get(l.item_id);
          return !!item?.is_available && unitPrice(item, l.variant_id, l.option_ids ?? []) !== null;
        })
        .map((l) => ({ ...l, qty: Math.min(Math.max(l.qty, 1), MAX_QTY) }));
      if (next.length !== cur.length) setAdjusted(true);
      return next.length === cur.length && next.every((l, i) => l.qty === cur[i]!.qty) ? cur : next;
    });
  }, [ready, items]);

  useEffect(() => {
    if (!ready) return;
    if (lines.length === 0 && !note) remove(key);
    else writeJson(key, { v: 1, lines, note } satisfies StoredCart);
  }, [ready, lines, note, key]);

  const setQty = useCallback((lineId: string, qty: number) => {
    setLines((cur) => {
      const q = Math.min(Math.max(qty, 0), MAX_QTY);
      if (q === 0) return cur.filter((l) => l.id !== lineId);
      return cur.map((l) => (l.id === lineId ? { ...l, qty: q } : l));
    });
  }, []);

  const addConfigured = useCallback((itemId: string, variantId: string | undefined, optionIds: string[], qty: number) => {
    const id = lineKey(itemId, variantId, optionIds);
    setLines((cur) => {
      const have = cur.find((l) => l.id === id);
      if (have) return cur.map((l) => (l.id === id ? { ...l, qty: Math.min(l.qty + qty, MAX_QTY) } : l));
      return [...cur, { id, item_id: itemId, ...(variantId ? { variant_id: variantId } : {}), ...(optionIds.length ? { option_ids: [...optionIds].sort() } : {}), qty: Math.min(Math.max(qty, 1), MAX_QTY) }];
    });
  }, []);

  return useMemo<Cart>(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const totalPaise = lines.reduce((n, l) => {
      const item = items.get(l.item_id);
      return n + (item ? (unitPrice(item, l.variant_id, l.option_ids ?? []) ?? 0) : 0) * l.qty;
    }, 0);
    return {
      lines,
      note,
      ready,
      adjusted,
      count,
      totalPaise,
      qtyOf: (itemId) => lines.filter((l) => l.item_id === itemId).reduce((n, l) => n + l.qty, 0),
      add: (itemId) => addConfigured(itemId, undefined, [], 1),
      addConfigured,
      setQty,
      setLineNote: (id, n) => setLines((cur) => cur.map((l) => (l.id === id ? { ...l, note: n } : l))),
      setNote,
      clear: () => {
        setLines([]);
        setNote('');
      },
      dismissAdjusted: () => setAdjusted(false),
    };
  }, [lines, note, ready, adjusted, items, setQty, addConfigured]);
}

/** One idempotency key per distinct cart content: a retry of the same cart can never create a second order. */
export function idempotencyKeyFor(slug: string, fingerprint: string): string {
  const key = `gm:idem:${slug}`;
  const stored = readJson<{ fp: string; key: string }>(key);
  if (stored?.fp === fingerprint) return stored.key;
  const fresh = crypto.randomUUID();
  writeJson(key, { fp: fingerprint, key: fresh });
  return fresh;
}
export const forgetIdempotencyKey = (slug: string) => remove(`gm:idem:${slug}`);

export interface LiveStatus {
  data: StatusData | null;
  /** 'none': this phone has no table session (401) */
  phase: 'idle' | 'ok' | 'error' | 'none';
  refresh(): void;
}

const BASE_DELAY = 4000;
const MAX_DELAY = 30000;

/**
 * Polls the guest's own table status every 4 s, backing off up to 30 s on errors, pausing while the tab is hidden
 * (or the phone is offline). Anonymous guests deliberately do not use realtime.
 */
export function useLiveStatus(slug: string, enabled: boolean): LiveStatus {
  const [data, setData] = useState<StatusData | null>(null);
  const [phase, setPhase] = useState<LiveStatus['phase']>('idle');
  const delay = useRef(BASE_DELAY);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const stopped = useRef(false);
  const tick = useRef<() => void>(() => undefined);

  tick.current = async () => {
    clearTimeout(timer.current);
    if (stopped.current) return;
    if (document.hidden || !navigator.onLine) return; // resumed by the visibility / online listeners
    abort.current?.abort();
    abort.current = new AbortController();
    try {
      const s = await fetchStatus(slug, abort.current.signal);
      setData(s);
      setPhase('ok');
      delay.current = BASE_DELAY;
      if (s.state === 'expired') return; // nothing more to watch
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (e instanceof ApiFailure && e.status === 401) {
        setPhase('none');
        return;
      }
      setPhase('error');
      delay.current = Math.min(delay.current * 2, MAX_DELAY);
    }
    timer.current = setTimeout(() => tick.current(), delay.current);
  };

  useEffect(() => {
    if (!enabled) return;
    stopped.current = false;
    delay.current = BASE_DELAY;
    tick.current();
    const wake = () => {
      delay.current = BASE_DELAY;
      tick.current();
    };
    const onVisibility = () => {
      if (!document.hidden) wake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', wake);
    return () => {
      stopped.current = true;
      clearTimeout(timer.current);
      abort.current?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', wake);
    };
  }, [enabled, slug]);

  return {
    data,
    phase,
    refresh: () => {
      stopped.current = false;
      delay.current = BASE_DELAY;
      tick.current();
    },
  };
}
