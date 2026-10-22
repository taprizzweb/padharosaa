import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, rpc, rpcErr, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());

async function table(t: 'A' | 'B' = 'A') {
  const ten = w[t];
  const [r] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning id, qr_token`, [ten.rid, `R${randomUUID().slice(0, 5)}`]);
  return { id: r!.id, token: r!.qr_token };
}
const board = async (uid: string) => (await rpc(db, uid, 'public.staff_get_board()'))[0]!.r as Record<string, any[]> & { server_time: string };

describe('staff_me', () => {
  it('returns role and restaurant settings for staff, null for strangers and deactivated staff', async () => {
    const me = (await rpc(db, w.A.waiter, 'public.staff_me()'))[0]!.r as any;
    expect(me).toMatchObject({ role: 'waiter', restaurant: { slug: 'cafe-aroma', status: 'active', amber_minutes: 5, red_minutes: 10 } });
    expect((await rpc(db, w.stranger, 'public.staff_me()'))[0]!.r).toBeNull();
    await db.admin(`update public.staff set active = false where user_id = $1`, [w.A.kitchen]);
    expect((await rpc(db, w.A.kitchen, 'public.staff_me()'))[0]!.r).toBeNull();
    await db.admin(`update public.staff set active = true where user_id = $1`, [w.A.kitchen]);
  });
});

describe('staff_get_board', () => {
  it('lists open orders with items, notes and table labels, oldest first', async () => {
    const t = await table();
    const a = await placeOrder(db, w.A, t, [{ item_id: w.A.paneer, qty: 2, note: 'no onion' }, { item_id: w.A.chai, qty: 1 }], { note: 'less spicy' });
    const b = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 3 }]);
    const o = (await board(w.A.kitchen)).orders!.filter((x: any) => x.session_id === a.session_id);
    expect(o.map((x: any) => x.order_no)).toEqual([a.order_no, b.order_no]);
    expect(o[0]).toMatchObject({ status: 'placed', note: 'less spicy', total_paise: 53000 });
    expect(o[0].items).toEqual([{ name: 'Masala Chai', qty: 1, note: null }, { name: 'Paneer Butter Masala', qty: 2, note: 'no onion' }]);
    expect(o[0].table_label).toMatch(/^R/);
  });

  it('only shows live orders: served, cancelled and closed-table orders disappear', async () => {
    const t = await table();
    const served = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    const cancelled = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    const live = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    for (const s of ['preparing', 'ready', 'served']) await rpc(db, w.A.waiter, 'public.staff_set_order_status($1,$2)', [served.order_id, s]);
    await rpc(db, w.A.waiter, `public.staff_set_order_status($1,'cancelled','x')`, [cancelled.order_id]);
    let ids = (await board(w.A.owner)).orders!.map((x: any) => x.id);
    expect(ids).toContain(live.order_id);
    expect(ids).not.toContain(served.order_id);
    expect(ids).not.toContain(cancelled.order_id);
    await rpc(db, w.A.manager, `public.staff_close_session($1, true, 'reset')`, [live.session_id]);
    ids = (await board(w.A.owner)).orders!.map((x: any) => x.id);
    expect(ids).not.toContain(live.order_id);
  });

  it('shows open waiter calls and bill requests (with payment mode) and open tables with totals', async () => {
    const t = await table();
    const o = await placeOrder(db, w.A, t, [{ item_id: w.A.paneer, qty: 1 }, { item_id: w.A.chai, qty: 2 }]);
    await db.as('service_role', null, `select public.guest_create_request($1,'waiter','cutlery')`, [o.session_id]);
    await db.as('service_role', null, `select public.guest_create_request($1,'bill',null,'upi')`, [o.session_id]);
    const b = await board(w.A.waiter);
    const reqs = b.requests!.filter((r: any) => r.session_id === o.session_id);
    expect(reqs.map((r: any) => [r.type, r.reason, r.pay_mode])).toEqual([['waiter', 'cutlery', null], ['bill', null, 'upi']]);
    const s = b.sessions!.find((x: any) => x.id === o.session_id);
    expect(s).toMatchObject({ total_paise: 31000, orders_count: 1, unserved_count: 1, pay_mode: 'upi' });
    expect(s.bill_requested_at).toBeTruthy();
    // resolved requests leave the board
    const [req] = await db.admin<{ id: string }>(`select id from public.service_requests where session_id = $1 and type = 'waiter'`, [o.session_id]);
    await rpc(db, w.A.waiter, 'public.staff_resolve_request($1)', [req!.id]);
    expect((await board(w.A.waiter)).requests!.filter((r: any) => r.session_id === o.session_id).map((r: any) => r.type)).toEqual(['bill']);
  });

  it('a table with only a waiter call (no order yet) still appears so staff can close it', async () => {
    const t = await table();
    const r = (await db.as<{ r: { session_id: string } }>('service_role', null, `select public.guest_request_by_token($1,$2,'waiter','water',null,null) r`, [w.A.slug, t.token]))[0]!.r;
    const s = (await board(w.A.manager)).sessions!.find((x: any) => x.id === r.session_id);
    expect(s).toMatchObject({ total_paise: 0, orders_count: 0, unserved_count: 0 });
  });

  it('the kitchen sees orders only: no waiter calls, bills or payment info', async () => {
    const t = await table();
    const o = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    await db.as('service_role', null, `select public.guest_create_request($1,'bill',null,'card')`, [o.session_id]);
    const b = await board(w.A.kitchen);
    expect(b.orders!.length).toBeGreaterThan(0);
    expect(b.requests).toEqual([]);
    expect(b.sessions).toEqual([]);
  });

  it('never leaks another restaurant\'s orders, requests or tables', async () => {
    const tb = await table('B');
    const ob = await placeOrder(db, w.B, tb, [{ item_id: w.B.chai, qty: 1 }]);
    await db.as('service_role', null, `select public.guest_create_request($1,'waiter','help')`, [ob.session_id]);
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter, w.A.kitchen]) {
      const b = await board(uid);
      expect(JSON.stringify(b)).not.toContain(ob.order_id);
      expect(JSON.stringify(b)).not.toContain(ob.session_id);
    }
    const mine = await board(w.B.owner);
    expect(mine.orders!.some((x: any) => x.id === ob.order_id)).toBe(true);
  });

  it('refuses strangers, deactivated staff, anon and service_role', async () => {
    expect((await rpcErr(db, w.stranger, 'public.staff_get_board()'))?.code).toBe('GM011');
    expect((await db.asErr('anon', null, 'select public.staff_get_board()'))?.code).toBe('42501');
    expect((await db.asErr('service_role', null, 'select public.staff_get_board()'))?.code).toBe('42501');
    await db.admin(`update public.staff set active = false where user_id = $1`, [w.A.waiter]);
    expect((await rpcErr(db, w.A.waiter, 'public.staff_get_board()'))?.code).toBe('GM011');
    await db.admin(`update public.staff set active = true where user_id = $1`, [w.A.waiter]);
  });

  it('still readable while the restaurant is suspended (writes are what is blocked)', async () => {
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect(await rpcErr(db, w.A.owner, 'public.staff_get_board()')).toBeNull();
    expect((await rpc(db, w.A.owner, 'public.staff_me()'))[0]!.r).toMatchObject({ restaurant: { status: 'suspended' } });
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
  });

  it('includes the server clock so screens can compute waiting time without trusting their own clock', async () => {
    const b = await board(w.A.owner);
    expect(Math.abs(Date.parse(b.server_time) - Date.now())).toBeLessThan(5000);
  });
});

describe('staff_list_items', () => {
  it('lists the restaurant\'s items with availability for every role, nothing from other restaurants', async () => {
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter, w.A.kitchen]) {
      const items = (await rpc(db, uid, 'public.staff_list_items()'))[0]!.r as any[];
      expect(items.map((i) => i.id).sort()).toEqual([w.A.paneer, w.A.chai, w.A.soldOut, w.A.platter].sort());
      expect(items.find((i) => i.id === w.A.soldOut)).toMatchObject({ name: 'Dal Makhani', is_available: false, category: 'Mains' });
      expect(items.some((i) => i.id === w.B.paneer)).toBe(false);
    }
  });
  it('refuses strangers and anon', async () => {
    expect((await rpcErr(db, w.stranger, 'public.staff_list_items()'))?.code).toBe('GM011');
    expect((await db.asErr('anon', null, 'select public.staff_list_items()'))?.code).toBe('42501');
  });
});
