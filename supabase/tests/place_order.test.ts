import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, orderErr, placeOrder, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());

/** Fresh table so caps/state from one test never leak into the next. */
async function freshTable(t: 'A' | 'B' = 'A') {
  const ten = w[t];
  const label = `T${randomUUID().slice(0, 6)}`;
  const [r] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning id, qr_token`, [ten.rid, label]);
  return { id: r!.id, token: r!.qr_token, label };
}

describe('guest_place_order: happy path and price integrity', () => {
  it('computes the total from database prices and snapshots names and prices', async () => {
    const t = await freshTable();
    const res = await placeOrder(db, w.A, t, [
      { item_id: w.A.paneer, qty: 2, note: 'less spicy' },
      { item_id: w.A.chai, qty: 3 },
    ], { note: 'Table near window' });
    expect(res.total_paise).toBe(2 * 25000 + 3 * 3000);
    expect(res.status).toBe('placed');
    expect(res.replayed).toBe(false);
    expect(res.table_label).toBe(t.label);
    const lines = await db.admin<{ name_en_snapshot: string; name_hi_snapshot: string; unit_price_paise: number; qty: number; note: string | null }>(
      `select name_en_snapshot, name_hi_snapshot, unit_price_paise, qty, note from public.order_items where order_id = $1 order by name_en_snapshot`,
      [res.order_id],
    );
    expect(lines).toEqual([
      { name_en_snapshot: 'Masala Chai', name_hi_snapshot: 'मसाला चाय', unit_price_paise: 3000, qty: 3, note: null },
      { name_en_snapshot: 'Paneer Butter Masala', name_hi_snapshot: 'पनीर बटर मसाला', unit_price_paise: 25000, qty: 2, note: 'less spicy' },
    ]);
  });

  it('ignores any price or total the client tries to send', async () => {
    const t = await freshTable();
    const res = await placeOrder(db, w.A, t, [{ item_id: w.A.paneer, qty: 1, price_paise: 1, unit_price_paise: 1, total_paise: 1 }]);
    expect(res.total_paise).toBe(25000);
    const [l] = await db.admin<{ unit_price_paise: number }>(`select unit_price_paise from public.order_items where order_id = $1`, [res.order_id]);
    expect(l!.unit_price_paise).toBe(25000);
  });

  it('later price changes do not rewrite past orders', async () => {
    const t = await freshTable();
    const res = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    await db.admin(`update public.items set price_paise = 9999, name_en = 'Changed' where id = $1`, [w.A.chai]);
    const [l] = await db.admin<{ unit_price_paise: number; name_en_snapshot: string }>(`select unit_price_paise, name_en_snapshot from public.order_items where order_id = $1`, [res.order_id]);
    expect(l).toEqual({ unit_price_paise: 3000, name_en_snapshot: 'Masala Chai' });
    await db.admin(`update public.items set price_paise = 3000, name_en = 'Masala Chai' where id = $1`, [w.A.chai]);
  });

  it('further orders from the same table join the same open session', async () => {
    const t = await freshTable();
    const a = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    const b = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    expect(b.session_id).toBe(a.session_id);
    expect(b.order_no).toBe(a.order_no + 1);
  });

  it('order numbers are per restaurant', async () => {
    const ta = await freshTable('A');
    const tb = await freshTable('B');
    const a = await placeOrder(db, w.A, ta, [{ item_id: w.A.chai, qty: 1 }]);
    const b1 = await placeOrder(db, w.B, tb, [{ item_id: w.B.chai, qty: 1 }]);
    const b2 = await placeOrder(db, w.B, tb, [{ item_id: w.B.chai, qty: 1 }]);
    expect(b2.order_no).toBe(b1.order_no + 1);
    expect(a.order_no).toBeGreaterThan(0);
    const [ra] = await db.admin<{ order_counter: string }>(`select order_counter from public.restaurants where id = $1`, [w.A.rid]);
    expect(Number(ra!.order_counter)).toBeGreaterThanOrEqual(a.order_no);
  });
});

describe('guest_place_order: rejections', () => {
  it('rejects unavailable items (sold out)', async () => {
    const t = await freshTable();
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.soldOut, qty: 1 }]))?.code).toBe('GM003');
  });
  it('rejects items in an inactive category', async () => {
    const t = await freshTable();
    await db.admin(`update public.categories set active = false where id = $1`, [w.A.catId]);
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.paneer, qty: 1 }]))?.code).toBe('GM003');
    await db.admin(`update public.categories set active = true where id = $1`, [w.A.catId]);
  });
  it('rejects another restaurant\'s item (foreign item)', async () => {
    const t = await freshTable();
    expect((await orderErr(db, w.A, t, [{ item_id: w.B.paneer, qty: 1 }]))?.code).toBe('GM004');
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.paneer, qty: 1 }, { item_id: w.B.chai, qty: 1 }]))?.code).toBe('GM004');
  });
  it('rejects unknown item ids', async () => {
    const t = await freshTable();
    expect((await orderErr(db, w.A, t, [{ item_id: randomUUID(), qty: 1 }]))?.code).toBe('GM004');
  });
  it('rejects the same item listed twice', async () => {
    const t = await freshTable();
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }, { item_id: w.A.chai, qty: 2 }]))?.code).toBe('GM005');
  });
  it('rejects a bad token, a token for another restaurant\'s slug, and an inactive table', async () => {
    const t = await freshTable();
    expect((await orderErr(db, w.A, { token: 'f'.repeat(64) }, [{ item_id: w.A.chai, qty: 1 }]))?.code).toBe('GM002');
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { slug: w.B.slug }))?.code).toBe('GM002');
    await db.admin(`update public.dining_tables set active = false where id = $1`, [t.id]);
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]))?.code).toBe('GM002');
  });
  it('rejects malformed input', async () => {
    const t = await freshTable();
    const bad: Array<[string, unknown[]]> = [
      ['empty cart', []],
      ['qty zero', [{ item_id: w.A.chai, qty: 0 }]],
      ['negative qty', [{ item_id: w.A.chai, qty: -2 }]],
      ['bad uuid', [{ item_id: 'not-a-uuid', qty: 1 }]],
      ['missing qty', [{ item_id: w.A.chai }]],
      ['missing item', [{ qty: 1 }]],
      ['line note too long', [{ item_id: w.A.chai, qty: 1, note: 'x'.repeat(101) }]],
    ];
    for (const [name, items] of bad) {
      expect((await orderErr(db, w.A, t, items as never))?.code, name).toBe('GM015');
    }
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { note: 'x'.repeat(201) }))?.code).toBe('GM015');
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { idem: 'short' }))?.code).toBe('GM015');
    const notArray = await db.asErr('service_role', null, `select public.guest_place_order($1,$2,'{"a":1}'::jsonb,null,$3,null)`, [w.A.slug, t.token, randomUUID()]);
    expect(notArray?.code).toBe('GM015');
  });
  it('rejects suspended restaurants and accepts again after re-activation', async () => {
    const t = await freshTable();
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]))).toBeNull();
  });
  it('a failed order leaves nothing behind (no order, no counter bump, no session)', async () => {
    const t = await freshTable();
    const [before] = await db.admin<{ c: string }>(`select order_counter c from public.restaurants where id = $1`, [w.A.rid]);
    await orderErr(db, w.A, t, [{ item_id: w.A.soldOut, qty: 1 }]);
    const [after] = await db.admin<{ c: string }>(`select order_counter c from public.restaurants where id = $1`, [w.A.rid]);
    expect(after!.c).toBe(before!.c);
    const s = await db.admin(`select 1 from public.table_sessions where table_id = $1`, [t.id]);
    expect(s.length).toBe(0);
  });
});

describe('guest_place_order: anti-spam caps', () => {
  it('max quantity per item (10) and max total (Rs 15,000)', async () => {
    const t = await freshTable();
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 11 }]))?.code).toBe('GM006');
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 10 }]))).toBeNull();
    const t2 = await freshTable();
    // 10 x Rs 2000 = Rs 20,000 > Rs 15,000
    expect((await orderErr(db, w.A, t2, [{ item_id: w.A.platter, qty: 10 }]))?.code).toBe('GM006');
    expect((await orderErr(db, w.A, t2, [{ item_id: w.A.platter, qty: 7 }]))).toBeNull(); // Rs 14,000
  });
  it('max 25 lines per order', async () => {
    const t = await freshTable();
    const ids: string[] = [];
    for (let i = 0; i < 26; i++) {
      const [r] = await db.admin<{ id: string }>(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,$3,100) returning id`, [w.A.rid, w.A.catId, `Bulk ${i}-${randomUUID().slice(0, 4)}`]);
      ids.push(r!.id);
    }
    expect((await orderErr(db, w.A, t, ids.map((id) => ({ item_id: id, qty: 1 }))))?.code).toBe('GM006');
    expect((await orderErr(db, w.A, t, ids.slice(0, 25).map((id) => ({ item_id: id, qty: 1 }))))).toBeNull();
  });
  it('max 3 un-accepted orders per table session', async () => {
    const t = await freshTable();
    for (let i = 0; i < 3; i++) await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]))?.code).toBe('GM008');
    // staff accept one -> the guest may order again
    const [o] = await db.admin<{ id: string }>(`select id from public.orders where table_id = $1 limit 1`, [t.id]);
    await db.as('authenticated', w.A.waiter, `select public.staff_set_order_status($1,'preparing')`, [o!.id]);
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]))).toBeNull();
  });
  it('max 8 orders per table per 10 minutes', async () => {
    const t = await freshTable();
    for (let i = 0; i < 8; i++) {
      const r = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
      await db.as('authenticated', w.A.waiter, `select public.staff_set_order_status($1,'preparing')`, [r.order_id]);
    }
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]))?.code).toBe('GM007');
  });
  it('per-IP cap: 60 successful orders per 10 minutes, then blocked; other IPs unaffected', async () => {
    const ip = `hash-${randomUUID()}`;
    for (let i = 0; i < 60; i++) {
      const t = await freshTable();
      await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { ip });
    }
    const t = await freshTable();
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { ip }))?.code).toBe('GM007');
    expect(await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { ip: `hash-${randomUUID()}` })).toBeNull();
  });
  it('guest_rate_limit commits independently, so FAILED attempts (token guessing) are throttled', async () => {
    const key = `ip:${randomUUID()}`;
    const hit = async () => (await db.as<{ r: boolean }>('service_role', null, `select public.guest_rate_limit($1, 5, 600) r`, [key]))[0]!.r;
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) results.push(await hit());
    expect(results).toEqual([true, true, true, true, true, false, false, false]);
    // a different key is independent
    expect((await db.as<{ r: boolean }>('service_role', null, `select public.guest_rate_limit($1, 5, 600) r`, [`ip:${randomUUID()}`]))[0]!.r).toBe(true);
  });
  it('guest_rate_check never counts; guest_rate_hit adds one failure; the check flips only once the limit is reached', async () => {
    const key = `tok:${randomUUID()}`;
    const check = async () => (await db.as<{ r: boolean }>('service_role', null, `select public.guest_rate_check($1, 3, 600) r`, [key]))[0]!.r;
    const hit = () => db.as('service_role', null, `select public.guest_rate_hit($1, 600)`, [key]);
    for (let i = 0; i < 10; i++) expect(await check()).toBe(true); // checking alone changes nothing
    await hit(); await hit();
    expect(await check()).toBe(true);
    await hit();
    expect(await check()).toBe(false);
    await db.admin(`update public.rate_limits set window_start = now() - interval '11 minutes' where key = $1`, [key]);
    expect(await check()).toBe(true); // window expired
    expect((await db.asErr('authenticated', w.A.owner, `select public.guest_rate_hit('x', 60)`))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.guest_rate_check('x', 1, 60)`))?.code).toBe('42501');
  });
  it('the window resets after it expires', async () => {
    const key = `ip:${randomUUID()}`;
    for (let i = 0; i < 3; i++) await db.as('service_role', null, `select public.guest_rate_limit($1, 2, 60)`, [key]);
    expect((await db.as<{ r: boolean }>('service_role', null, `select public.guest_rate_limit($1, 2, 60) r`, [key]))[0]!.r).toBe(false);
    await db.admin(`update public.rate_limits set window_start = now() - interval '2 minutes' where key = $1`, [key]);
    expect((await db.as<{ r: boolean }>('service_role', null, `select public.guest_rate_limit($1, 2, 60) r`, [key]))[0]!.r).toBe(true);
  });
  it('stale counters (older than a day, i.e. hashed IPs) are deleted automatically as the limiter is used', async () => {
    await db.admin(`insert into public.rate_limits (key, window_start, count) values ('stale-ip-key', now() - interval '2 days', 1)`);
    // ~2% of calls clean up; 1500 calls make a miss astronomically unlikely (0.98^1500 = 7e-14)
    for (let i = 0; i < 1500; i++) {
      await db.as('service_role', null, `select public.guest_rate_limit($1, 1000000, 600)`, ['cleanup-probe']);
      const [r] = await db.admin<{ n: number }>(`select count(*)::int n from public.rate_limits where key = 'stale-ip-key'`);
      if (r!.n === 0) return;
    }
    throw new Error('stale rate-limit row was never purged');
  });
  it('old counters are purged', async () => {
    await db.admin(`insert into public.rate_limits (key, window_start, count) values ('old-key', now() - interval '3 days', 1)`);
    const [r] = await db.as<{ n: number }>('service_role', null, `select public.guest_purge_rate_limits() n`);
    expect(r!.n).toBeGreaterThanOrEqual(1);
  });
});

describe('guest_place_order: idempotency', () => {
  it('the same idempotency key returns the same order and creates nothing new', async () => {
    const t = await freshTable();
    const idem = randomUUID();
    const a = await placeOrder(db, w.A, t, [{ item_id: w.A.paneer, qty: 1 }], { idem });
    const b = await placeOrder(db, w.A, t, [{ item_id: w.A.paneer, qty: 1 }], { idem });
    expect(b.order_id).toBe(a.order_id);
    expect(b.replayed).toBe(true);
    const [n] = await db.admin<{ n: number }>(`select count(*)::int n from public.orders where table_id = $1`, [t.id]);
    expect(n!.n).toBe(1);
  });
  it('a replay is not blocked by caps (a retry after a dropped response must still succeed)', async () => {
    const t = await freshTable();
    const idem = randomUUID();
    await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { idem });
    await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]);
    expect((await orderErr(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }]))?.code).toBe('GM008');
    const again = await placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { idem });
    expect(again.replayed).toBe(true);
  });
  it('the same key on a different table is a different order', async () => {
    const t1 = await freshTable();
    const t2 = await freshTable();
    const idem = randomUUID();
    const a = await placeOrder(db, w.A, t1, [{ item_id: w.A.chai, qty: 1 }], { idem });
    const b = await placeOrder(db, w.A, t2, [{ item_id: w.A.chai, qty: 1 }], { idem });
    expect(b.order_id).not.toBe(a.order_id);
  });
});

describe('guest_place_order: concurrency (race safety)', () => {
  it('24 parallel orders across 8 tables: unique gap-free order numbers, one open session per table', async () => {
    const tables = await Promise.all(Array.from({ length: 8 }, () => freshTable()));
    const [before] = await db.admin<{ c: string }>(`select order_counter c from public.restaurants where id = $1`, [w.A.rid]);
    const jobs = tables.flatMap((t) => Array.from({ length: 3 }, () => placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }])));
    const results = await Promise.all(jobs);
    const nos = results.map((r) => r.order_no).sort((a, b) => a - b);
    expect(new Set(nos).size).toBe(24);
    expect(nos[23]! - nos[0]!).toBe(23); // gap-free
    expect(nos[0]).toBe(Number(before!.c) + 1);
    for (const t of tables) {
      const [s] = await db.admin<{ n: number }>(`select count(*)::int n from public.table_sessions where table_id = $1 and closed_at is null`, [t.id]);
      expect(s!.n).toBe(1);
    }
  });
  it('10 simultaneous orders on ONE table: exactly 3 get through (pending cap), one session', async () => {
    const t = await freshTable();
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }])));
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const failed = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(ok.length).toBe(3);
    expect(failed.every((f) => (f.reason as { code: string }).code === 'GM008')).toBe(true);
    const [s] = await db.admin<{ n: number }>(`select count(*)::int n from public.table_sessions where table_id = $1`, [t.id]);
    expect(s!.n).toBe(1);
  });
  it('5 simultaneous retries with the same key create exactly one order', async () => {
    const t = await freshTable();
    const idem = randomUUID();
    const rs = await Promise.all(Array.from({ length: 5 }, () => placeOrder(db, w.A, t, [{ item_id: w.A.chai, qty: 1 }], { idem })));
    expect(new Set(rs.map((r) => r.order_id)).size).toBe(1);
    expect(rs.filter((r) => !r.replayed).length).toBe(1);
    const [n] = await db.admin<{ n: number }>(`select count(*)::int n from public.orders where table_id = $1`, [t.id]);
    expect(n!.n).toBe(1);
  });
  it('a manager changing a price while an order is in flight never produces a mixed total', async () => {
    const t = await freshTable();
    const [order] = await Promise.all([
      placeOrder(db, w.A, t, [{ item_id: w.A.paneer, qty: 2 }]),
      db.as('authenticated', w.A.manager, `update public.items set price_paise = 30000 where id = $1`, [w.A.paneer]),
    ]);
    const [l] = await db.admin<{ unit_price_paise: number }>(`select unit_price_paise from public.order_items where order_id = $1`, [order.order_id]);
    expect([25000, 30000]).toContain(l!.unit_price_paise);
    expect(order.total_paise).toBe(l!.unit_price_paise * 2); // total always agrees with the snapshot
    await db.admin(`update public.items set price_paise = 25000 where id = $1`, [w.A.paneer]);
  });
});

describe('guest_get_menu', () => {
  it('returns the menu with availability, hides inactive categories, validates the table token', async () => {
    const t = await freshTable();
    const [row] = await db.as<{ m: Record<string, any> }>('service_role', null, `select public.guest_get_menu($1,$2) m`, [w.A.slug, t.token]);
    const m = row!.m;
    expect(m.status).toBe('active');
    expect(m.token_valid).toBe(true);
    expect(m.table_label).toBe(t.label);
    const items = m.categories.flatMap((c: any) => c.items);
    expect(items.find((i: any) => i.id === w.A.soldOut).is_available).toBe(false);
    expect(items.some((i: any) => i.id === w.B.paneer)).toBe(false);
    expect(JSON.stringify(m)).not.toContain(t.token); // the token is never echoed back
    const [bad] = await db.as<{ m: Record<string, any> }>('service_role', null, `select public.guest_get_menu($1,$2) m`, [w.A.slug, 'f'.repeat(64)]);
    expect(bad!.m.token_valid).toBe(false);
    expect(bad!.m.table_label).toBeNull();
    const [other] = await db.as<{ m: Record<string, any> }>('service_role', null, `select public.guest_get_menu($1,$2) m`, [w.B.slug, t.token]);
    expect(other!.m.token_valid).toBe(false); // A's token does not validate on B's menu
  });
  it('reports suspended restaurants without leaking the menu; unknown slug is not_found', async () => {
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.B.rid]);
    const [row] = await db.as<{ m: Record<string, any> }>('service_role', null, `select public.guest_get_menu($1,null) m`, [w.B.slug]);
    expect(row!.m.status).toBe('suspended');
    expect(row!.m.categories).toBeUndefined();
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.B.rid]);
    expect((await db.asErr('service_role', null, `select public.guest_get_menu('no-such-place')`))?.code).toBe('GM012');
  });
});
