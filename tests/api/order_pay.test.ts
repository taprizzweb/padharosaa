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
import { POST as payPOST } from '@/app/api/guest/order-pay/route';
import { POST as qrPOST } from '@/app/api/padharosaa/v1/staff/pay-qr/route';
import { GET as settingsGET } from '@/app/api/padharosaa/v1/staff/settings/route';

// A hotel room order: the guest chooses "Add to room receipt" or "Pay now" (the hotel's payment QR image).
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
async function roomOrder(kind: 'room' | 'table' = 'room') {
  const [t] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1, $2, $3) returning id, qr_token`, [w.A.rid, `Room ${randomUUID().slice(0, 4)}`, kind]);
  const o = await placeOrder(db, w.A, { token: t!.qr_token }, [{ item_id: w.A.chai, qty: 1 }]);
  return { ...o, token: t!.qr_token };
}
const pay = (token: string, no: number, method: unknown, slug = w.A.slug) => payPOST(req('/api/guest/order-pay', { slug, token, order_no: no, method }, { ip: uniqueIp() }));
const qr = (path: string | null) => qrPOST(req('/api/padharosaa/v1/staff/pay-qr', { path }));
const card = async (id: string) => ((await json(await boardGET(req('/api/staff/board')))).orders as any[]).find((x) => x.id === id);

describe('payment QR (owner) and the guest\'s payment choice', () => {
  it('owner or manager sets the QR image inside their own hotel folder; reception, strangers and other hotels cannot; bad paths are refused', async () => {
    const good = `${w.A.rid}/payqr-test.png`;
    as(w.A.waiter);
    expect((await qr(good)).status).toBe(403);
    as(w.stranger);
    expect((await qr(good)).status).toBe(403);
    as(w.A.owner);
    for (const bad of [`${w.B.rid}/payqr.png`, '../x.png', `${w.A.rid}/a/b.png`, `${w.A.rid}/`, 'payqr.png', `${w.A.rid}/x y.png`]) expect((await qr(bad)).status, bad).toBe(400);
    expect((await qr(good)).status).toBe(200);
    as(w.A.manager);
    expect((await json(await settingsGET(req('/api/padharosaa/v1/staff/settings')))).pay_qr_path).toBe(good);
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where restaurant_id = $1 and action = 'padh_pay_qr_set'`, [w.A.rid]))[0].n).toBeGreaterThan(0);
  });

  it('the guest adds a room order to the room receipt or pays now; the choice shows on the desk and in the guest status; it can be changed', async () => {
    as(w.A.owner);
    await qr(`${w.A.rid}/payqr-test.png`);
    const o = await roomOrder();
    expect((await pay(o.token, o.order_no, 'room_bill')).status).toBe(200);
    as(w.A.waiter);
    expect(await card(o.order_id)).toMatchObject({ pay_method: 'room_bill' });
    expect((await pay(o.token, o.order_no, 'pay_now')).status).toBe(200);
    expect(await card(o.order_id)).toMatchObject({ pay_method: 'pay_now' });
    const row = (await db.admin<any>(`select public.guest_get_status($1) as r`, [o.session_id]))[0].r;
    expect(row).toMatchObject({ is_room: true, pay_qr_path: `${w.A.rid}/payqr-test.png` });
    expect(row.orders[0].pay_method).toBe('pay_now');
  });

  it('bad input, a wrong token, another hotel, a plain restaurant table, a cancelled order and a hotel with no QR are all refused', async () => {
    const o = await roomOrder();
    for (const bad of ['cash', '', null, 5]) expect((await pay(o.token, o.order_no, bad)).status, String(bad)).toBe(400);
    expect((await pay('f'.repeat(64), o.order_no, 'room_bill')).status).toBe(404);
    expect((await pay(o.token, o.order_no + 99, 'room_bill')).status).toBe(404);
    expect((await pay(o.token, o.order_no, 'room_bill', w.B.slug)).status).toBe(404);
    expect((await payPOST(req('/api/guest/order-pay', { slug: w.A.slug, token: o.token, order_no: o.order_no, method: 'room_bill' }, { origin: 'https://evil.example', ip: uniqueIp() }))).status).toBe(403);
    const plain = await roomOrder('table');
    expect((await pay(plain.token, plain.order_no, 'room_bill')).status).toBe(409); // an ordinary restaurant table does not choose a room receipt
    await db.admin(`update public.orders set status = 'cancelled', cancel_reason = 'test', cancelled_at = now() where id = $1`, [o.order_id]);
    expect((await pay(o.token, o.order_no, 'room_bill')).status).toBe(409);
    as(w.A.owner);
    expect((await qr(null)).status).toBe(200); // QR removed
    const o2 = await roomOrder();
    expect((await pay(o2.token, o2.order_no, 'pay_now')).status).toBe(409); // nothing to show
    expect((await pay(o2.token, o2.order_no, 'room_bill')).status).toBe(200);
  });
});
