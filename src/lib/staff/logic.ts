/** Pure staff-screen rules (no React, no browser), so they can be unit tested. The database enforces the same rules. */

export type Role = 'owner' | 'manager' | 'waiter' | 'kitchen';
export type OrderStatus = 'placed' | 'preparing' | 'ready' | 'served' | 'cancelled';

export interface BoardOrder {
  id: string;
  order_no: number;
  status: OrderStatus;
  table_label: string;
  session_id: string;
  note: string | null;
  total_paise: number;
  created_at: string;
  preparing_at: string | null;
  ready_at: string | null;
  /** room orders only: how it reaches the guest */
  handover?: 'deliver' | 'takeaway' | null;
  handover_minutes?: number | null;
  ready_in_at?: string | null;
  guest_eta_minutes?: number | null;
  guest_eta_at?: string | null;
  /** hotel room order: how the guest settles it */
  pay_method?: 'room_bill' | 'pay_now' | null;
  is_room?: boolean;
  items: { name: string; qty: number; note: string | null }[];
}
export interface BoardRequest {
  id: string;
  type: 'waiter' | 'bill';
  reason: string | null;
  pay_mode: 'cash' | 'upi' | 'card' | null;
  table_label: string;
  session_id: string;
  created_at: string;
}
/** A guest's "call for problems" (towel, WiFi, light...), sent from the shared help link with a room number. */
export interface BoardHelp {
  id: string;
  room: string;
  topics: string[];
  note: string | null;
  created_at: string;
}
export interface BoardSession {
  id: string;
  table_label: string;
  opened_at: string;
  pay_mode: 'cash' | 'upi' | 'card' | null;
  bill_requested_at: string | null;
  total_paise: number;
  orders_count: number;
  unserved_count: number;
}
export interface BoardData {
  server_time: string;
  orders: BoardOrder[];
  requests: BoardRequest[];
  sessions: BoardSession[];
  /** false when a hotel has switched room dining off: then only takeaway is offered */
  room_dining?: boolean;
  /** open problems; absent only while an older database is still being upgraded */
  help?: BoardHelp[];
}

export type Severity = 'ok' | 'amber' | 'red';

/** Turns amber, then red, once an order has waited past the restaurant's thresholds (minutes). */
export function waitSeverity(ageSeconds: number, amberMinutes: number, redMinutes: number): Severity {
  if (ageSeconds >= redMinutes * 60) return 'red';
  if (ageSeconds >= amberMinutes * 60) return 'amber';
  return 'ok';
}

export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export interface OrderAction {
  to: 'preparing' | 'ready' | 'served' | 'cancelled';
  label: string;
  kind: 'primary' | 'danger';
}

export const canCancel = (role: Role): boolean => role === 'owner' || role === 'manager' || role === 'waiter';
export const canForceClose = (role: Role): boolean => role === 'owner' || role === 'manager';
export const canSeeRequests = (role: Role): boolean => role !== 'kitchen';
export const canClose = (role: Role): boolean => role !== 'kitchen';

/** Buttons shown on an order card. Mirrors staff_set_order_status in SQL (kitchen cannot cancel; cancel only before ready). */
export function orderActions(role: Role, status: OrderStatus): OrderAction[] {
  const out: OrderAction[] = [];
  if (status === 'placed') out.push({ to: 'preparing', label: 'Accept & start', kind: 'primary' });
  if (status === 'preparing') out.push({ to: 'ready', label: 'Mark ready', kind: 'primary' });
  if (status === 'ready') out.push({ to: 'served', label: 'Mark served', kind: 'primary' });
  if ((status === 'placed' || status === 'preparing') && canCancel(role)) out.push({ to: 'cancelled', label: 'Cancel', kind: 'danger' });
  return out;
}

export interface CloseOptions {
  /** the plain "Mark paid / Close table" button */
  canPay: boolean;
  /** owner/manager may close even with unserved orders, giving a reason */
  canForce: boolean;
  payLabel: string;
  blockedReason: string | null;
}

export function closeOptions(role: Role, s: Pick<BoardSession, 'total_paise' | 'unserved_count'>): CloseOptions {
  const payLabel = s.total_paise > 0 ? 'Mark paid' : 'Close table';
  if (!canClose(role)) return { canPay: false, canForce: false, payLabel, blockedReason: null };
  if (s.unserved_count === 0) return { canPay: true, canForce: false, payLabel, blockedReason: null };
  const n = s.unserved_count;
  const force = canForceClose(role);
  return { canPay: false, canForce: force, payLabel, blockedReason: `${n} ${n === 1 ? 'order is' : 'orders are'} not served yet. Serve or cancel ${n === 1 ? 'it' : 'them'} first${force ? ', or force close with a reason' : ''}.` };
}

export type AlertKind = 'order' | 'waiter' | 'bill' | 'help';
export const ALERT_REPEAT_MS = 6000;

/** Things that need a human right now: new (not yet accepted) orders, open waiter calls, open bill requests. */
export function pendingAlerts(board: Pick<BoardData, 'orders' | 'requests'> & { help?: BoardHelp[] }, role: Role): Record<AlertKind, string[]> {
  return {
    help: canSeeRequests(role) ? (board.help ?? []).map((h) => h.id) : [],
    order: board.orders.filter((o) => o.status === 'placed').map((o) => o.id),
    waiter: canSeeRequests(role) ? board.requests.filter((r) => r.type === 'waiter').map((r) => r.id) : [],
    bill: canSeeRequests(role) ? board.requests.filter((r) => r.type === 'bill').map((r) => r.id) : [],
  };
}

/** Kinds that currently have something pending, most urgent first (a customer waiting to pay beats a new order). */
export function activeKinds(p: Record<AlertKind, string[]>): AlertKind[] {
  return (['bill', 'help', 'waiter', 'order'] as const).filter((k) => p[k].length > 0);
}

/** Kinds with an id that was not pending in the previous snapshot: these sound immediately instead of waiting for the repeat. */
export function newKinds(prev: Record<AlertKind, Set<string>> | null, now: Record<AlertKind, string[]>): AlertKind[] {
  if (!prev) return activeKinds(now); // first load: announce what is already waiting
  return (['bill', 'help', 'waiter', 'order'] as const).filter((k) => now[k].some((id) => !prev[k].has(id)));
}

export const toSets = (p: Record<AlertKind, string[]>): Record<AlertKind, Set<string>> => ({ order: new Set(p.order), waiter: new Set(p.waiter), bill: new Set(p.bill), help: new Set(p.help) });

export const WAITER_REASON_LABEL: Record<string, string> = {
  water: 'Water',
  cutlery: 'Cutlery',
  cleaning: 'Table cleaning',
  help: 'Help with the menu',
  other: 'Something else',
};

/** What the staff screen listens to over Supabase Realtime. Row level security also filters events server-side. */
export const REALTIME_TABLES = ['orders', 'service_requests', 'table_sessions', 'help_requests'] as const;
/** Only this restaurant's rows: the filter is applied by the server, so other tenants' changes are never even delivered. */
export const realtimeFilter = (restaurantId: string): string => `restaurant_id=eq.${restaurantId}`;
export const realtimeChannel = (restaurantId: string): string => `board-${restaurantId}`;
