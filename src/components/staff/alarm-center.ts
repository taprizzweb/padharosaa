import { useSyncExternalStore } from 'react';
import { soundForRequest, soundsFor } from '@/lib/padharosaa/areas';
import { bannerText, freshIds, repeatEveryMs, tabTitle, type Waiting } from '@/lib/padharosaa/alarm';
import { AlertSound, type SoundKind } from './sound';

/**
 * The reception alarm. It is ONE object for the whole browser tab, not part of a page: going from the desk to the manager console or to
 * billing does not stop it. While the desk is open the desk feeds it its data; on any other page it asks the server itself.
 * Its beat comes from a worker (see public/alarm-worker.js) so a tab in the background keeps ringing.
 */
export interface AlarmInput {
  requests: { id: string; type: string; team: string; label: string; urgent: boolean; status: string; created_at: string; room?: string | null }[];
  orders: { id: string; status: string; created_at: string }[];
  calls: { id: string; type: string; created_at: string }[];
  muted: string[];
}
export interface AlarmItem extends Waiting { sound: SoundKind }
export interface AlarmSnapshot { on: boolean; needsTap: boolean; waiting: AlarmItem[]; text: string }

const KEY = 'padh-alarm';
const STAGGER_MS = 1100;
const EMPTY: AlarmSnapshot = { on: false, needsTap: false, waiting: [], text: '' };
const read = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };

class AlarmCenter {
  readonly sound = new AlertSound();
  private snap: AlarmSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private seenReq = new Set<string>(); private firstReq = true;
  private seenOrd = new Set<string>(); private firstOrd = true;
  private seenCall = new Set<string>(); private firstCall = true;
  private lastPlay = 0;
  private lastIngest = 0;
  private ticks = 0;
  private worker: Worker | null = null;
  private fallback: ReturnType<typeof setInterval> | null = null;
  private baseTitle = '';
  private polling = false;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;
  private set(next: Partial<AlarmSnapshot>) {
    const merged = { ...this.snap, ...next };
    if (merged.on === this.snap.on && merged.needsTap === this.snap.needsTap && merged.text === this.snap.text && merged.waiting === this.snap.waiting) return;
    this.snap = merged;
    this.listeners.forEach((l) => l());
  }

  /** Called when a screen with the alarm control appears: a page reload loses the audio permission, so it asks for one tap. */
  init(): void {
    if (typeof window === 'undefined') return;
    if (read() === '1' && !this.snap.on) this.set({ needsTap: true });
  }

  /** Must run from a click: browsers only allow sound after a tap. */
  async enable(): Promise<boolean> {
    const ok = await this.sound.enable();
    if (!ok) return false;
    write('1');
    this.set({ on: true, needsTap: false });
    this.startClock();
    void this.selfPoll();
    return true;
  }
  disable(): void {
    write('0');
    this.stopClock();
    this.restoreTitle();
    this.set({ on: false, needsTap: false });
  }
  play(kind: SoundKind): void { this.sound.play(kind); }

  /** The desk hands over what it just fetched, so the alarm does not ask the server a second time. */
  ingest(input: AlarmInput): void { this.lastIngest = Date.now(); this.process(input); }

  private playMany(kinds: SoundKind[]) { kinds.forEach((k, i) => setTimeout(() => this.sound.play(k), i * STAGGER_MS)); this.lastPlay = Date.now(); }

  private process(input: AlarmInput): void {
    const muted = new Set(input.muted);
    const open = input.requests.filter((r) => r.status === 'received' && !muted.has(r.team));
    const reqIds = input.requests.map((r) => r.id);
    const freshReq = new Set(freshIds(this.seenReq, reqIds, this.firstReq)); this.firstReq = false;
    const freshOrders = freshIds(this.seenOrd, input.orders.map((o) => o.id), this.firstOrd); this.firstOrd = false;
    const freshCalls = freshIds(this.seenCall, input.calls.map((c) => c.id), this.firstCall); this.firstCall = false;
    const waitingOrders = input.orders.filter((o) => o.status === 'placed' && !muted.has('kitchen'));
    const waiting: AlarmItem[] = [
      ...open.map((r) => ({ id: r.id, urgent: r.urgent, since: Date.parse(r.created_at), label: r.label, room: r.room ?? null, sound: soundForRequest({ urgent: r.urgent, type: r.type, team: r.team }) })),
      ...waitingOrders.map((o) => ({ id: o.id, urgent: false, since: Date.parse(o.created_at), label: 'Food order', room: null, sound: 'order' as SoundKind })),
    ];
    if (this.snap.on) {
      const freshOpen = open.filter((r) => freshReq.has(r.id));
      const kinds: SoundKind[] = [...soundsFor(freshOpen)];
      if (freshOrders.length && !muted.has('kitchen')) kinds.push('order');
      if (freshCalls.length) { const bill = input.calls.some((c) => freshCalls.includes(c.id) && c.type === 'bill'); kinds.push(bill ? 'bill' : 'waiter'); }
      if (kinds.length) {
        this.playMany(kinds);
        try { navigator.vibrate?.(freshOpen.some((r) => r.urgent) ? [400, 150, 400, 150, 800] : [250, 100, 250]); } catch { /* not supported */ }
      }
    }
    this.set({ waiting, text: bannerText(waiting) });
  }

  // ---- the clock ----
  private startClock() {
    if (this.worker || this.fallback) return;
    try {
      this.worker = new Worker('/alarm-worker.js');
      this.worker.onmessage = () => this.tick();
      this.worker.postMessage('start');
    } catch { this.fallback = setInterval(() => this.tick(), 1000); }
  }
  private stopClock() {
    this.worker?.postMessage('stop'); this.worker?.terminate(); this.worker = null;
    if (this.fallback) { clearInterval(this.fallback); this.fallback = null; }
  }
  private tick() {
    if (!this.snap.on) return;
    this.ticks++;
    const now = Date.now();
    if (now - this.lastIngest > 7000 && this.ticks % 4 === 0) void this.selfPoll(); // the desk is not open: ask the server ourselves
    const every = repeatEveryMs(this.snap.waiting, now);
    if (every !== null && now - this.lastPlay >= every) this.playMany([...new Set(this.snap.waiting.map((w) => w.sound))]);
    this.blinkTitle();
  }
  private blinkTitle() {
    if (typeof document === 'undefined') return;
    const w = this.snap.waiting;
    if (w.length === 0) { this.restoreTitle(); return; }
    if (!this.baseTitle) this.baseTitle = document.title.replace(/^(🔔|🚨) \d+ waiting$/, '') || 'Padharosaa';
    document.title = tabTitle(w.length, w.some((x) => x.urgent), this.ticks % 2 === 0, this.baseTitle);
  }
  private restoreTitle() { if (this.baseTitle && typeof document !== 'undefined') { document.title = this.baseTitle; this.baseTitle = ''; } }

  private async selfPoll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const get = async <T>(url: string): Promise<T | null> => { try { const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; } };
      const [b, a, ob] = await Promise.all([
        get<{ requests: AlarmInput['requests'] }>('/api/padharosaa/v1/staff/board'),
        get<{ muted: string[] }>('/api/padharosaa/v1/staff/alerts'),
        get<{ orders?: AlarmInput['orders']; requests?: AlarmInput['calls'] }>('/api/staff/board'),
      ]);
      if (b) this.process({ requests: b.requests, orders: ob?.orders ?? [], calls: ob?.requests ?? [], muted: a?.muted ?? [] });
    } finally { this.polling = false; }
  }
}

/** One alarm per browser tab. Never built on the server. */
export const alarm: AlarmCenter = typeof window === 'undefined' ? (null as unknown as AlarmCenter) : new AlarmCenter();

export function useAlarm(): AlarmSnapshot {
  return useSyncExternalStore(alarm ? alarm.subscribe : () => () => undefined, alarm ? alarm.getSnapshot : () => EMPTY, () => EMPTY);
}
