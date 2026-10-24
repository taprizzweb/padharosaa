import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, placeOrder, type World } from '../../supabase/tests/helpers/fixtures';
import { authState, req, state, uniqueIp } from './helpers';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
vi.mock('@/lib/supabase/server', async () => {
  const h = await import('./helpers');
  return { userClient: async () => h.fakeUserClient };
});
import { GET as boardGET } from '@/app/api/staff/board/route';
import { POST as handoverPOST } from '@/app/api/staff/order-handover/route';
import { POST as readyInPOST } from '@/app/api/staff/order-ready-in/route';
import { POST as etaPOST } from '@/app/api/guest/order-eta/route';

// Takeaway is run by the DESK: the desk says "ready in N minutes", then the guest says how long they will take to come.
let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, true)`, [w.A.rid]);
});
afterAll(async () => db.close());
beforeEach(() => { authState.userId = null; });

const as = (uid: string | null) => { authState.userId = uid; };
const json = async (r: Response) => (await r.json()) as Record<string, any>;
async function roomOrder() {
  const [t] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1, $2, 'room') returning id, qr_token`, [w.A.rid, `Room ${randomUUID().slice(0, 4)}`]);
  const o = await placeOrder(db, w.A, { token: t!.qr_token }, [{ item_id: w.A.chai, qty: 1 }]);
  return { ...o, token: t!.qr_token };
}
const handover = (id: string, mode: string) => handoverPOST(req('/api/staff/order-handover', { order_id: id, mode }));
const readyIn = (id: string, minutes: unknown) => readyInPOST(req('/api/staff/order-ready-in', { order_id: id, minutes }));
const eta = (token: string, no: number, minutes: unknown, slug = w.A.slug) => etaPOST(req('/api/guest/order-eta', { slug, token, order_no: no, minutes }, { ip: uniqueIp() }));
const card = async (id: string) => ((await json(await boardGET(req('/api/staff/board')))).orders as any[]).find((x) => x.id === id);

describe('takeaway time (desk) and the guest reply', () => {
  it('only a takeaway order can be given a time; the desk, the manager and the kitchen may; strangers and other hotels may not', async () => {
    const o = await roomOrder();
    as(w.A.waiter);
    expect((await readyIn(o.order_id, 15)).status).toBe(409); // not a takeaway yet
    expect((await handover(o.order_id, 'takeaway')).status).toBe(200);
    for (const bad of [0, 181, 1.5, 'soon', null]) expect((await readyIn(o.order_id, bad)).status, String(bad)).toBe(400);
    expect((await readyIn(o.order_id, 15)).status).toBe(200);
    expect(await card(o.order_id)).toMatchObject({ handover: 'takeaway', handover_minutes: 15, guest_eta_minutes: null });
    for (const uid of [w.A.manager, w.A.kitchen]) { as(uid); expect((await readyIn(o.order_id, 20)).status, uid).toBe(200); }
    as(w.stranger);
    expect((await readyIn(o.order_id, 10)).status).toBe(403);
    as(w.B.waiter);
    expect((await readyIn(o.order_id, 10)).status).toBe(404);
    expect((await readyInPOST(req('/api/staff/order-ready-in', { order_id: o.order_id, minutes: 10 }, { origin: 'https://evil.example' }))).status).toBe(403);
  });

  it('the guest answers only after the desk gave a time; the desk sees the answer; a new time asks again', async () => {
    const o = await roomOrder();
    as(w.A.waiter);
    await handover(o.order_id, 'takeaway');
    expect((await eta(o.token, o.order_no, 10)).status).toBe(409); // no time from the desk yet
    await readyIn(o.order_id, 20);
    const ok = await eta(o.token, o.order_no, 10);
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ guest_eta_minutes: 10 });
    expect(await card(o.order_id)).toMatchObject({ handover_minutes: 20, guest_eta_minutes: 10 });
    expect((await json(await eta(o.token, o.order_no, 0))).guest_eta_minutes).toBe(0); // "I am here now"
    await readyIn(o.order_id, 30); // the desk changes the time: the earlier answer is cleared
    expect(await card(o.order_id)).toMatchObject({ handover_minutes: 30, guest_eta_minutes: null });
  });

  it('the guest reply is limited to their own table and sane values', async () => {
    const o = await roomOrder();
    const other = await roomOrder();
    as(w.A.waiter);
    await handover(o.order_id, 'takeaway');
    await readyIn(o.order_id, 20);
    expect((await eta(other.token, o.order_no, 5)).status).toBe(404); // someone else's room
    expect((await eta(w.A.t1.token, o.order_no, 5)).status).toBe(404); // a table that is not theirs
    expect((await eta(o.token, o.order_no, 5, w.B.slug)).status).toBe(404);
    for (const bad of [-1, 181, 2.5, 'now']) expect((await eta(o.token, o.order_no, bad)).status, String(bad)).toBe(400);
    expect((await etaPOST(req('/api/guest/order-eta', { slug: w.A.slug, token: o.token, order_no: o.order_no, minutes: 5 }, { origin: 'https://evil.example', ip: uniqueIp() }))).status).toBe(403);
  });
});
