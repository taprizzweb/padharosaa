import { describe, expect, it } from 'vitest';
import { REALTIME_TABLES, realtimeChannel, realtimeFilter, ALERT_REPEAT_MS, activeKinds, canCancel, closeOptions, formatAge, newKinds, orderActions, pendingAlerts, toSets, waitSeverity, type BoardOrder, type BoardRequest, type OrderStatus, type Role } from '@/lib/staff/logic';

const ROLES: Role[] = ['owner', 'manager', 'waiter', 'kitchen'];
const order = (id: string, status: OrderStatus): BoardOrder => ({ id, order_no: 1, status, table_label: '5', session_id: 's', note: null, total_paise: 100, created_at: '2026-01-01T00:00:00Z', preparing_at: null, ready_at: null, items: [] });
const req = (id: string, type: 'waiter' | 'bill'): BoardRequest => ({ id, type, reason: null, pay_mode: null, table_label: '5', session_id: 's', created_at: '2026-01-01T00:00:00Z' });

describe('waiting-time colours', () => {
  it('is ok, then amber, then red at the configured thresholds (5 / 10 min)', () => {
    expect(waitSeverity(0, 5, 10)).toBe('ok');
    expect(waitSeverity(299, 5, 10)).toBe('ok');
    expect(waitSeverity(300, 5, 10)).toBe('amber');
    expect(waitSeverity(599, 5, 10)).toBe('amber');
    expect(waitSeverity(600, 5, 10)).toBe('red');
    expect(waitSeverity(99999, 5, 10)).toBe('red');
  });
  it('honours custom thresholds', () => {
    expect(waitSeverity(120, 2, 3)).toBe('amber');
    expect(waitSeverity(180, 2, 3)).toBe('red');
  });
  it('formats ages for a quick glance', () => {
    expect(formatAge(-5)).toBe('0s');
    expect(formatAge(9)).toBe('9s');
    expect(formatAge(65)).toBe('1m 05s');
    expect(formatAge(3599)).toBe('59m 59s');
    expect(formatAge(3720)).toBe('1h 02m');
  });
});

describe('order buttons per role (mirrors the SQL state machine)', () => {
  it('everyone advances placed -> preparing -> ready -> served', () => {
    for (const r of ROLES) {
      expect(orderActions(r, 'placed')[0]).toMatchObject({ to: 'preparing', label: 'Accept & start' });
      expect(orderActions(r, 'preparing')[0]).toMatchObject({ to: 'ready', label: 'Mark ready' });
      expect(orderActions(r, 'ready')[0]).toMatchObject({ to: 'served', label: 'Mark served' });
    }
  });
  it('cancel exists only before ready, and never for the kitchen', () => {
    for (const r of ROLES) {
      const cancellable = (s: OrderStatus) => orderActions(r, s).some((a) => a.to === 'cancelled');
      expect(cancellable('placed'), `${r} placed`).toBe(r !== 'kitchen');
      expect(cancellable('preparing'), `${r} preparing`).toBe(r !== 'kitchen');
      expect(cancellable('ready')).toBe(false);
      expect(cancellable('served')).toBe(false);
      expect(cancellable('cancelled')).toBe(false);
      expect(canCancel(r)).toBe(r !== 'kitchen');
    }
  });
  it('finished orders have no buttons', () => {
    for (const r of ROLES) {
      expect(orderActions(r, 'served')).toEqual([]);
      expect(orderActions(r, 'cancelled')).toEqual([]);
    }
  });
});

describe('closing a table', () => {
  it('allows Mark paid when everything is served, for waiter, manager and owner', () => {
    for (const r of ['owner', 'manager', 'waiter'] as const) {
      expect(closeOptions(r, { total_paise: 65000, unserved_count: 0 })).toMatchObject({ canPay: true, canForce: false, payLabel: 'Mark paid', blockedReason: null });
    }
  });
  it('says "Close table" when nothing was ordered', () => {
    expect(closeOptions('waiter', { total_paise: 0, unserved_count: 0 }).payLabel).toBe('Close table');
  });
  it('blocks a waiter while orders are unserved, explaining why; managers and owners may force', () => {
    const w = closeOptions('waiter', { total_paise: 100, unserved_count: 2 });
    expect(w).toMatchObject({ canPay: false, canForce: false });
    expect(w.blockedReason).toContain('2 orders are not served yet');
    for (const r of ['owner', 'manager'] as const) {
      const o = closeOptions(r, { total_paise: 100, unserved_count: 1 });
      expect(o).toMatchObject({ canPay: false, canForce: true });
      expect(o.blockedReason).toContain('1 order is not served yet');
      expect(o.blockedReason).toContain('force close');
    }
  });
  it('the kitchen can do nothing here', () => {
    expect(closeOptions('kitchen', { total_paise: 100, unserved_count: 0 })).toMatchObject({ canPay: false, canForce: false });
  });
});

describe('alert bookkeeping', () => {
  const board = { orders: [order('o1', 'placed'), order('o2', 'preparing')], requests: [req('r1', 'waiter'), req('r2', 'bill')] };
  it('only un-accepted orders, open calls and open bills are pending', () => {
    expect(pendingAlerts(board, 'waiter')).toEqual({ order: ['o1'], waiter: ['r1'], bill: ['r2'], help: [] });
  });
  it('the kitchen only gets order alerts', () => {
    expect(pendingAlerts(board, 'kitchen')).toEqual({ order: ['o1'], waiter: [], bill: [], help: [] });
  });
  it('accepting an order or resolving a request removes it (alert stops repeating)', () => {
    const after = { orders: [order('o1', 'preparing')], requests: [] };
    expect(activeKinds(pendingAlerts(after, 'owner'))).toEqual([]);
  });
  it('most urgent kind first: bill, then a guest problem, then waiter, then order', () => {
    expect(activeKinds(pendingAlerts(board, 'owner'))).toEqual(['bill', 'waiter', 'order']);
    const withHelp = { ...board, help: [{ id: 'h1', room: '201', topics: ['Towel or bedsheet'], note: null, created_at: '2026-10-20T10:00:00Z' }] };
    expect(activeKinds(pendingAlerts(withHelp, 'owner'))).toEqual(['bill', 'help', 'waiter', 'order']);
  });
  it('guest problems alert reception staff, never the kitchen, and stop once someone taps Done', () => {
    const withHelp = { ...board, help: [{ id: 'h1', room: '201', topics: [], note: 'Light is out', created_at: '2026-10-20T10:00:00Z' }] };
    expect(pendingAlerts(withHelp, 'waiter').help).toEqual(['h1']);
    expect(pendingAlerts(withHelp, 'manager').help).toEqual(['h1']);
    expect(pendingAlerts(withHelp, 'kitchen').help).toEqual([]);
    expect(pendingAlerts({ ...withHelp, help: [] }, 'waiter').help).toEqual([]);
    expect(pendingAlerts(board, 'waiter').help).toEqual([]); // an older board without the list
  });
  it('announces only genuinely new items (and everything on first load)', () => {
    const first = pendingAlerts(board, 'owner');
    expect(newKinds(null, first)).toEqual(['bill', 'waiter', 'order']);
    const prev = toSets(first);
    expect(newKinds(prev, first)).toEqual([]);
    const withNew = { ...first, order: ['o1', 'o3'] };
    expect(newKinds(prev, withNew)).toEqual(['order']);
    expect(newKinds(prev, { order: [], waiter: [], bill: [], help: [] })).toEqual([]);
    expect(newKinds(prev, { ...first, help: ['h9'] })).toEqual(['help']);
  });
  it('repeats every 6 seconds', () => {
    expect(ALERT_REPEAT_MS).toBe(6000);
  });
});

describe('realtime subscription', () => {
  const id = '8d3f1a52-6c0e-4b7a-9f21-3e5a7c9b1d44';
  it('listens to orders, requests, table sessions and guest problems only, filtered to one restaurant', () => {
    expect([...REALTIME_TABLES]).toEqual(['orders', 'service_requests', 'table_sessions', 'help_requests']);
    expect(realtimeFilter(id)).toBe(`restaurant_id=eq.${id}`);
    expect(realtimeChannel(id)).toBe(`board-${id}`);
  });
});
