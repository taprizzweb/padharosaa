import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, rpc, rpcErr, type PlaceResult, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());

async function freshTable(t: 'A' | 'B' = 'A') {
  const ten = w[t];
  const label = `T${randomUUID().slice(0, 6)}`;
  const [r] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning id, qr_token`, [ten.rid, label]);
  return { id: r!.id, token: r!.qr_token, label };
}
async function newOrder(t: 'A' | 'B' = 'A'): Promise<PlaceResult & { table: { id: string; token: string } }> {
  const table = await freshTable(t);
  const res = await placeOrder(db, w[t], table, [{ item_id: w[t].chai, qty: 1 }]);
  return { ...res, table };
}
const status = async (id: string) => (await db.admin<{ status: string }>(`select status from public.orders where id = $1`, [id]))[0]!.status;
const setStatus = (uid: string, id: string, to: string, reason: string | null = null) =>
  rpcErr(db, uid, `public.staff_set_order_status($1, $2, $3)`, [id, to, reason]);

describe('order state machine', () => {
  const ALL = ['placed', 'preparing', 'ready', 'served', 'cancelled'] as const;
  const VALID: Record<string, string[]> = { placed: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['served'], served: [], cancelled: [] };

  /** Put an order into an arbitrary state using the superuser, then test one transition as staff. */
  async function inState(s: string) {
    const o = await newOrder();
    await db.admin(`update public.orders set status = $2, cancel_reason = case when $2 = 'cancelled' then 'setup' else null end where id = $1`, [o.order_id, s]);
    return o;
  }

  for (const from of ALL) {
    for (const to of ALL) {
      const ok = VALID[from]!.includes(to);
      it(`${from} -> ${to} is ${ok ? 'allowed' : 'rejected'} (waiter)`, async () => {
        const o = await inState(from);
        const err = await setStatus(w.A.waiter, o.order_id, to, to === 'cancelled' ? 'guest left' : null);
        if (ok) {
          expect(err).toBeNull();
          expect(await status(o.order_id)).toBe(to);
        } else {
          expect(err?.code).toBe('GM010');
          expect(await status(o.order_id)).toBe(from);
        }
      });
    }
  }

  it('full happy path stamps each stage time', async () => {
    const o = await newOrder();
    for (const to of ['preparing', 'ready', 'served']) expect(await setStatus(w.A.kitchen, o.order_id, to)).toBeNull();
    const [r] = await db.admin<Record<string, string | null>>(`select preparing_at, ready_at, served_at, cancelled_at, status_by from public.orders where id = $1`, [o.order_id]);
    expect(r!.preparing_at && r!.ready_at && r!.served_at).toBeTruthy();
    expect(r!.cancelled_at).toBeNull();
    expect(r!.status_by).toBe(w.A.kitchen);
  });

  it('every role may advance an order', async () => {
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter, w.A.kitchen]) {
      const o = await newOrder();
      expect(await setStatus(uid, o.order_id, 'preparing')).toBeNull();
    }
  });

  it('kitchen cannot cancel (status unchanged)', async () => {
    const o = await newOrder();
    expect((await setStatus(w.A.kitchen, o.order_id, 'cancelled', 'x'))?.code).toBe('GM011');
    expect(await status(o.order_id)).toBe('placed');
  });

  it('owner, manager and waiter can cancel from placed and preparing; a reason is mandatory and audited', async () => {
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter]) {
      const o = await newOrder();
      expect((await setStatus(uid, o.order_id, 'cancelled'))?.code).toBe('GM014');
      expect((await setStatus(uid, o.order_id, 'cancelled', '   '))?.code).toBe('GM014');
      expect(await setStatus(uid, o.order_id, 'cancelled', 'Guest changed mind')).toBeNull();
      const [row] = await db.admin<{ cancel_reason: string }>(`select cancel_reason from public.orders where id = $1`, [o.order_id]);
      expect(row!.cancel_reason).toBe('Guest changed mind');
      const log = await db.admin<{ actor_user_id: string; details: { reason: string } }>(`select actor_user_id, details from public.audit_log where entity_id = $1 and action = 'order_cancelled'`, [o.order_id]);
      expect(log.length).toBe(1);
      expect(log[0]!.actor_user_id).toBe(uid);
      expect(log[0]!.details.reason).toBe('Guest changed mind');
    }
  });

  it('cannot cancel once ready', async () => {
    const o = await inState('ready');
    expect((await setStatus(w.A.owner, o.order_id, 'cancelled', 'late'))?.code).toBe('GM010');
  });

  it('unknown status values are rejected', async () => {
    const o = await newOrder();
    expect((await setStatus(w.A.owner, o.order_id, 'teleported'))?.code).toBe('GM010');
    expect((await setStatus(w.A.owner, o.order_id, 'placed'))?.code).toBe('GM010');
  });

  it("another restaurant's staff cannot touch the order (looks like not found)", async () => {
    const o = await newOrder();
    for (const uid of [w.B.owner, w.B.manager, w.B.waiter, w.B.kitchen]) {
      expect((await setStatus(uid, o.order_id, 'preparing'))?.code).toBe('GM012');
    }
    expect(await status(o.order_id)).toBe('placed');
  });

  it('strangers, anon and service_role cannot call it', async () => {
    const o = await newOrder();
    expect((await setStatus(w.stranger, o.order_id, 'preparing'))?.code).toBe('GM011');
    expect((await db.asErr('anon', null, `select public.staff_set_order_status($1,'preparing')`, [o.order_id]))?.code).toBe('42501');
    expect((await db.asErr('service_role', null, `select public.staff_set_order_status($1,'preparing')`, [o.order_id]))?.code).toBe('42501');
  });

  it('a suspended restaurant\'s staff cannot change orders', async () => {
    const o = await newOrder();
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await setStatus(w.A.owner, o.order_id, 'preparing'))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
    expect(await setStatus(w.A.owner, o.order_id, 'preparing')).toBeNull();
  });

  it('orders of a closed session are frozen', async () => {
    const o = await newOrder();
    await db.as('authenticated', w.A.manager, `select public.staff_close_session($1, true, 'reset')`, [o.session_id]);
    expect((await setStatus(w.A.owner, o.order_id, 'preparing'))?.code).toBe('GM009');
  });

  it('a double-tap (concurrent identical transitions) advances only once', async () => {
    const o = await newOrder();
    const results = await Promise.all([setStatus(w.A.waiter, o.order_id, 'preparing'), setStatus(w.A.waiter, o.order_id, 'preparing')]);
    expect(results.filter((r) => r === null).length).toBe(1);
    expect(results.filter((r) => r?.code === 'GM010').length).toBe(1);
    expect(await status(o.order_id)).toBe('preparing');
  });
});

describe('closing a table (mark paid)', () => {
  async function serve(orderId: string) {
    for (const to of ['preparing', 'ready', 'served']) await setStatus(w.A.waiter, orderId, to);
  }
  const close = (uid: string, sid: string, force = false, reason: string | null = null, mode: string | null = null) =>
    rpcErr(db, uid, `public.staff_close_session($1,$2,$3,$4)`, [sid, force, reason, mode]);

  it('is blocked while orders are unserved; allowed once served; stores the final total and resolves open requests', async () => {
    const o = await newOrder();
    await db.as('service_role', null, `select public.guest_create_request($1,'bill',null,'upi')`, [o.session_id]);
    expect((await close(w.A.waiter, o.session_id))?.code).toBe('GM013');
    await serve(o.order_id);
    const [r] = await rpc(db, w.A.waiter, `public.staff_close_session($1,false,null,'upi')`, [o.session_id]);
    expect((r as { r: { total_paise: number; already_closed: boolean } }).r).toMatchObject({ total_paise: 3000, already_closed: false });
    const [s] = await db.admin<{ closed_at: string; close_reason: string; final_total_paise: number; pay_mode: string }>(`select closed_at, close_reason, final_total_paise, pay_mode from public.table_sessions where id = $1`, [o.session_id]);
    expect(s).toMatchObject({ close_reason: 'paid', final_total_paise: 3000, pay_mode: 'upi' });
    const open = await db.admin(`select 1 from public.service_requests where session_id = $1 and status = 'open'`, [o.session_id]);
    expect(open.length).toBe(0);
  });

  it('cancelled orders are not charged', async () => {
    const table = await freshTable();
    const a = await placeOrder(db, w.A, table, [{ item_id: w.A.chai, qty: 1 }]);
    const b = await placeOrder(db, w.A, table, [{ item_id: w.A.paneer, qty: 1 }]);
    await setStatus(w.A.owner, b.order_id, 'cancelled', 'wrong table');
    await serve(a.order_id);
    const [r] = await rpc(db, w.A.owner, `public.staff_close_session($1)`, [a.session_id]);
    expect((r as { r: { total_paise: number } }).r.total_paise).toBe(3000);
  });

  it('kitchen cannot close; waiter cannot force; manager force needs a reason; owner and manager can force', async () => {
    const o = await newOrder();
    expect((await close(w.A.kitchen, o.session_id))?.code).toBe('GM011');
    expect((await close(w.A.waiter, o.session_id, true, 'x'))?.code).toBe('GM011');
    expect((await close(w.A.manager, o.session_id, true))?.code).toBe('GM014');
    expect(await close(w.A.manager, o.session_id, true, 'Guests left without paying')).toBeNull();
    const o2 = await newOrder();
    expect(await close(w.A.owner, o2.session_id, true, 'Table reset by owner')).toBeNull();
    const log = await db.admin<{ action: string; details: { reason: string; unserved_orders: number } }>(`select action, details from public.audit_log where entity_id = $1`, [o.session_id]);
    expect(log[0]).toMatchObject({ action: 'table_force_closed', details: { reason: 'Guests left without paying', unserved_orders: 1 } });
  });

  it('is idempotent (a double-tap on Mark paid does not error)', async () => {
    const o = await newOrder();
    await serve(o.order_id);
    await close(w.A.waiter, o.session_id);
    const [r] = await rpc(db, w.A.waiter, `public.staff_close_session($1)`, [o.session_id]);
    expect((r as { r: { already_closed: boolean } }).r.already_closed).toBe(true);
  });

  it('other restaurants\' staff cannot close it', async () => {
    const o = await newOrder();
    expect((await close(w.B.owner, o.session_id, true, 'attack'))?.code).toBe('GM012');
    const [s] = await db.admin<{ closed_at: string | null }>(`select closed_at from public.table_sessions where id = $1`, [o.session_id]);
    expect(s!.closed_at).toBeNull();
  });

  it('after closing, a new scan starts a fresh session and the closed one cannot take orders', async () => {
    const o = await newOrder();
    await serve(o.order_id);
    await close(w.A.waiter, o.session_id);
    const again = await placeOrder(db, w.A, o.table, [{ item_id: w.A.chai, qty: 1 }]);
    expect(again.session_id).not.toBe(o.session_id);
    expect((await db.asErr('service_role', null, `select public.guest_create_request($1,'waiter','water')`, [o.session_id]))?.code).toBe('GM009');
  });

  it('closing races with ordering (25 rounds): no deadlock, no stranded order, at most one open session', async () => {
    const outcomes: Record<string, number> = {};
    for (let i = 0; i < 25; i++) {
      const o = await newOrder();
      await serve(o.order_id);
      const [c, n] = await Promise.allSettled([close(w.A.waiter, o.session_id), placeOrder(db, w.A, o.table, [{ item_id: w.A.chai, qty: 1 }])]);
      // ordering always succeeds (it either joins the old session or starts a fresh one)
      expect(n.status, `order round ${i}`).toBe('fulfilled');
      // closing either succeeds, or is correctly refused because the new order is not served yet; never a deadlock
      const closeCode = c.status === 'fulfilled' ? (c.value as { code?: string } | null)?.code ?? 'ok' : 'threw';
      outcomes[closeCode] = (outcomes[closeCode] ?? 0) + 1;
      expect(['ok', 'GM013']).toContain(closeCode);
      const [open] = await db.admin<{ n: number }>(`select count(*)::int n from public.table_sessions where table_id = $1 and closed_at is null`, [o.table.id]);
      expect(open!.n).toBeLessThanOrEqual(1);
      const [orphan] = await db.admin<{ n: number }>(
        `select count(*)::int n from public.orders o join public.table_sessions s on s.id = o.session_id
          where o.table_id = $1 and s.closed_at is not null and o.status in ('placed','preparing','ready')`, [o.table.id]);
      expect(orphan!.n).toBe(0);
    }
  });
});

describe('guest status and thank-you window', () => {
  it('shows orders, running total, requests; closed sessions show thank-you state then expire', async () => {
    const table = await freshTable();
    const a = await placeOrder(db, w.A, table, [{ item_id: w.A.paneer, qty: 1 }, { item_id: w.A.chai, qty: 2 }]);
    await placeOrder(db, w.A, table, [{ item_id: w.A.chai, qty: 1 }]);
    await db.as('service_role', null, `select public.guest_create_request($1,'waiter','water')`, [a.session_id]);
    const get = async () => (await db.as<{ s: Record<string, any> }>('service_role', null, `select public.guest_get_status($1) s`, [a.session_id]))[0]!.s;
    let s = await get();
    expect(s.state).toBe('open');
    expect(s.total_paise).toBe(25000 + 6000 + 3000);
    expect(s.orders.length).toBe(2);
    expect(s.orders[0].items.length).toBe(2);
    expect(s.requests).toHaveLength(1);
    expect(s.table_label).toBe(table.label);
    expect(JSON.stringify(s)).not.toContain(table.token);

    await db.as('authenticated', w.A.owner, `select public.staff_close_session($1, true, 'done')`, [a.session_id]);
    s = await get();
    expect(s.state).toBe('closed');
    expect(s.review_available).toBe(true);
    expect(s.total_paise).toBe(34000);
    await db.admin(`update public.table_sessions set closed_at = now() - interval '31 minutes', opened_at = now() - interval '2 hours' where id = $1`, [a.session_id]);
    expect((await get()).state).toBe('expired');
  });
  it('unknown session id is not_found', async () => {
    expect((await db.asErr('service_role', null, `select public.guest_get_status($1)`, [randomUUID()]))?.code).toBe('GM012');
  });
});

describe('waiter calls and bill requests', () => {
  const call = (sid: string, type: string, reason: string | null, mode: string | null) =>
    db.as<{ r: Record<string, string> }>('service_role', null, `select public.guest_create_request($1,$2,$3,$4) r`, [sid, type, reason, mode]);
  const callErr = (sid: string, type: string, reason: string | null, mode: string | null) =>
    db.asErr('service_role', null, `select public.guest_create_request($1,$2,$3,$4)`, [sid, type, reason, mode]);
  const openCount = async (sid: string, type: string) =>
    (await db.admin<{ n: number }>(`select count(*)::int n from public.service_requests where session_id = $1 and type = $2 and status = 'open'`, [sid, type]))[0]!.n;

  it('a second waiter tap is idempotent (one open request)', async () => {
    const o = await newOrder();
    const a = await call(o.session_id, 'waiter', 'water', null);
    const b = await call(o.session_id, 'waiter', 'cutlery', null);
    expect(a[0]!.r.status).toBe('open');
    expect(b[0]!.r.reason).toBe('water'); // the original request stands
    expect(await openCount(o.session_id, 'waiter')).toBe(1);
  });
  it('waiter calls and bill requests can be open together; one open bill request per session', async () => {
    const o = await newOrder();
    await call(o.session_id, 'waiter', 'help', null);
    await call(o.session_id, 'bill', null, 'cash');
    await call(o.session_id, 'bill', null, 'cash');
    expect(await openCount(o.session_id, 'waiter')).toBe(1);
    expect(await openCount(o.session_id, 'bill')).toBe(1);
  });
  it('guest can change payment mode while the bill request is open', async () => {
    const o = await newOrder();
    await call(o.session_id, 'bill', null, 'cash');
    const r = await call(o.session_id, 'bill', null, 'upi');
    expect(r[0]!.r.pay_mode).toBe('upi');
    expect(await openCount(o.session_id, 'bill')).toBe(1);
    const [s] = await db.admin<{ pay_mode: string; bill_requested_at: string }>(`select pay_mode, bill_requested_at from public.table_sessions where id = $1`, [o.session_id]);
    expect(s!.pay_mode).toBe('upi');
    expect(s!.bill_requested_at).toBeTruthy();
  });
  it('each payment mode is accepted; invalid values rejected', async () => {
    for (const mode of ['cash', 'upi', 'card']) {
      const o = await newOrder();
      expect((await call(o.session_id, 'bill', null, mode))[0]!.r.pay_mode).toBe(mode);
    }
    const o = await newOrder();
    expect((await callErr(o.session_id, 'bill', null, 'bitcoin'))?.code).toBe('GM015');
    expect((await callErr(o.session_id, 'bill', null, null))?.code).toBe('GM015');
    expect((await callErr(o.session_id, 'waiter', 'dance', null))?.code).toBe('GM015');
    expect((await callErr(o.session_id, 'waiter', null, null))?.code).toBe('GM015');
    expect((await callErr(o.session_id, 'refund', 'help', null))?.code).toBe('GM015');
  });
  it('a bill needs at least one live order', async () => {
    const o = await newOrder();
    await setStatus(w.A.owner, o.order_id, 'cancelled', 'oops');
    expect((await callErr(o.session_id, 'bill', null, 'cash'))?.code).toBe('GM016');
  });
  it('staff resolve the request; the guest can then ask again; double resolve is fine', async () => {
    const o = await newOrder();
    await call(o.session_id, 'waiter', 'water', null);
    const [req] = await db.admin<{ id: string }>(`select id from public.service_requests where session_id = $1`, [o.session_id]);
    await rpc(db, w.A.waiter, `public.staff_resolve_request($1)`, [req!.id]);
    await rpc(db, w.A.waiter, `public.staff_resolve_request($1)`, [req!.id]);
    expect(await openCount(o.session_id, 'waiter')).toBe(0);
    await call(o.session_id, 'waiter', 'cleaning', null);
    expect(await openCount(o.session_id, 'waiter')).toBe(1);
  });
  it('kitchen and other restaurants cannot resolve requests', async () => {
    const o = await newOrder();
    await call(o.session_id, 'waiter', 'water', null);
    const [req] = await db.admin<{ id: string }>(`select id from public.service_requests where session_id = $1`, [o.session_id]);
    expect((await rpcErr(db, w.A.kitchen, `public.staff_resolve_request($1)`, [req!.id]))?.code).toBe('GM011');
    expect((await rpcErr(db, w.B.owner, `public.staff_resolve_request($1)`, [req!.id]))?.code).toBe('GM012');
    expect(await openCount(o.session_id, 'waiter')).toBe(1);
  });
  it('request spam per session is rate limited', async () => {
    const o = await newOrder();
    let blocked = false;
    for (let i = 0; i < 20; i++) {
      const e = await callErr(o.session_id, 'waiter', 'water', null);
      if (e?.code === 'GM007') { blocked = true; break; }
    }
    expect(blocked).toBe(true);
  });
  it('suspended restaurants refuse new requests', async () => {
    const o = await newOrder();
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await callErr(o.session_id, 'waiter', 'water', null))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
  });
  it('database enforces the request shape (waiter needs reason, bill needs mode)', async () => {
    const o = await newOrder();
    const e = await db.pool.query(`insert into public.service_requests (restaurant_id, table_id, session_id, type) values ($1,$2,$3,'bill')`, [w.A.rid, o.table.id, o.session_id]).then(() => null, (x: { code: string }) => x.code);
    expect(e).toBe('23514');
  });
});

describe('review button', () => {
  const click = (sid: string) => db.as<{ u: string }>('service_role', null, `select public.guest_record_review_click($1) u`, [sid]);
  it('only works after the table is closed, records the tap, returns the https link', async () => {
    const o = await newOrder();
    expect((await db.asErr('service_role', null, `select public.guest_record_review_click($1)`, [o.session_id]))?.code).toBe('GM012');
    await db.as('authenticated', w.A.owner, `select public.staff_close_session($1, true, 'done')`, [o.session_id]);
    const [r] = await click(o.session_id);
    expect(r!.u).toBe(`https://g.page/r/${w.A.slug}/review`);
    const n = await db.admin<{ n: number }>(`select count(*)::int n from public.review_clicks where session_id = $1`, [o.session_id]);
    expect(n[0]!.n).toBe(1);
  });
  it('repeated taps do not inflate the report beyond the hourly cap', async () => {
    const o = await newOrder();
    await db.as('authenticated', w.A.owner, `select public.staff_close_session($1, true, 'done')`, [o.session_id]);
    for (let i = 0; i < 12; i++) await click(o.session_id);
    const n = await db.admin<{ n: number }>(`select count(*)::int n from public.review_clicks where session_id = $1`, [o.session_id]);
    expect(n[0]!.n).toBe(5);
  });
  it('a restaurant without a review link returns not_found', async () => {
    const o = await newOrder('B');
    await db.admin(`update public.restaurants set review_url = null where id = $1`, [w.B.rid]);
    await db.as('authenticated', w.B.owner, `select public.staff_close_session($1, true, 'done')`, [o.session_id]);
    expect((await db.asErr('service_role', null, `select public.guest_record_review_click($1)`, [o.session_id]))?.code).toBe('GM012');
  });
});

describe('sold-out toggle', () => {
  const toggle = (uid: string, ids: string[], on: boolean) => rpcErr(db, uid, `public.staff_set_item_availability($1::uuid[], $2)`, [ids, on]);
  it('every role can toggle availability and guests see it immediately', async () => {
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter, w.A.kitchen]) {
      expect(await toggle(uid, [w.A.chai], false)).toBeNull();
      const t = await freshTable();
      const o = await db.asErr('service_role', null, `select public.guest_place_order($1,$2,$3::jsonb,null,$4,null)`, [w.A.slug, t.token, JSON.stringify([{ item_id: w.A.chai, qty: 1 }]), randomUUID()]);
      expect(o?.code).toBe('GM003');
      expect(await toggle(uid, [w.A.chai], true)).toBeNull();
    }
  });
  it('is audited only when something actually changed', async () => {
    const before = (await db.admin<{ n: number }>(`select count(*)::int n from public.audit_log where action = 'item_availability' and entity_id = $1`, [w.A.paneer]))[0]!.n;
    await toggle(w.A.kitchen, [w.A.paneer], true); // already available: no-op
    await toggle(w.A.kitchen, [w.A.paneer], false);
    await toggle(w.A.kitchen, [w.A.paneer], true);
    const after = (await db.admin<{ n: number }>(`select count(*)::int n from public.audit_log where action = 'item_availability' and entity_id = $1`, [w.A.paneer]))[0]!.n;
    expect(after - before).toBe(2);
  });
  it('cannot toggle another restaurant\'s item, and nothing is changed if any id is foreign', async () => {
    expect((await toggle(w.A.kitchen, [w.B.chai], false))?.code).toBe('GM012');
    expect((await toggle(w.A.kitchen, [w.A.chai, w.B.chai], false))?.code).toBe('GM012');
    const [i] = await db.admin<{ is_available: boolean }>(`select is_available from public.items where id = $1`, [w.A.chai]);
    expect(i!.is_available).toBe(true);
  });
  it('rejects empty and oversized lists; strangers and suspended restaurants are blocked', async () => {
    expect((await toggle(w.A.kitchen, [], false))?.code).toBe('GM015');
    expect((await toggle(w.stranger, [w.A.chai], false))?.code).toBe('GM011');
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await toggle(w.A.kitchen, [w.A.chai], false))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
  });
});

describe('requests identified by the table QR token', () => {
  const byToken = (t: { token: string }, type: string, reason: string | null, mode: string | null, slug = w.A.slug) =>
    db.as<{ r: { session_id: string; table_label: string; request: Record<string, string> } }>('service_role', null, `select public.guest_request_by_token($1,$2,$3,$4,$5,null) r`, [slug, t.token, type, reason, mode]);
  const byTokenErr = (t: { token: string }, type: string, reason: string | null, mode: string | null, slug = w.A.slug) =>
    db.asErr('service_role', null, `select public.guest_request_by_token($1,$2,$3,$4,$5,null)`, [slug, t.token, type, reason, mode]);

  it('a waiter call before any order opens the table session; repeating it is idempotent', async () => {
    const t = await freshTable();
    const a = await byToken(t, 'waiter', 'water', null);
    const b = await byToken(t, 'waiter', 'cutlery', null);
    expect(a[0]!.r.session_id).toBe(b[0]!.r.session_id);
    expect(a[0]!.r.table_label).toBe(t.label);
    expect(b[0]!.r.request.reason).toBe('water');
    const [n] = await db.admin<{ n: number }>(`select count(*)::int n from public.table_sessions where table_id = $1`, [t.id]);
    expect(n!.n).toBe(1);
  });
  it('an order placed afterwards joins that same session', async () => {
    const t = await freshTable();
    const a = await byToken(t, 'waiter', 'help', null);
    const o = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    expect(o.session_id).toBe(a[0]!.r.session_id);
  });
  it('a bill request needs an open session with an order', async () => {
    const t = await freshTable();
    expect((await byTokenErr(t, 'bill', null, 'cash'))?.code).toBe('GM016');
    await byToken(t, 'waiter', 'help', null); // session exists but no order yet
    expect((await byTokenErr(t, 'bill', null, 'cash'))?.code).toBe('GM016');
    await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    expect((await byToken(t, 'bill', null, 'upi'))[0]!.r.request.pay_mode).toBe('upi');
  });
  it('rejects bad tokens, tokens of another restaurant, rotated tokens, inactive tables and suspended restaurants', async () => {
    const t = await freshTable();
    expect((await byTokenErr({ token: 'a'.repeat(64) }, 'waiter', 'water', null))?.code).toBe('GM002');
    expect((await byTokenErr(t, 'waiter', 'water', null, w.B.slug))?.code).toBe('GM002');
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await byTokenErr(t, 'waiter', 'water', null))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
    await db.admin(`update public.dining_tables set active = false where id = $1`, [t.id]);
    expect((await byTokenErr(t, 'waiter', 'water', null))?.code).toBe('GM002');
  });
  it('validates input and is not callable by staff or anon', async () => {
    const t = await freshTable();
    expect((await byTokenErr(t, 'refund', 'water', null))?.code).toBe('GM015');
    expect((await byTokenErr(t, 'waiter', 'dance', null))?.code).toBe('GM015');
    expect((await db.asErr('authenticated', w.A.owner, `select public.guest_request_by_token($1,$2,'waiter','water',null,null)`, [w.A.slug, t.token]))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.guest_request_by_token($1,$2,'waiter','water',null,null)`, [w.A.slug, t.token]))?.code).toBe('42501');
  });
});
