import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, type World } from './helpers/fixtures';

// Auto bill to the room (migration 0055): only room orders, only when the owner or manager switched it on.
let db: TestDb;
let w: World;
const set = async (uid: string, on: unknown) => (await db.as('authenticated', uid, `select public.padh_set_auto_room_bill($1) as r`, [on] as never))[0]!.r;
const setErr = (uid: string, on: unknown) => db.asErr('authenticated', uid, `select public.padh_set_auto_room_bill($1) as r`, [on] as never);
async function order(kind: 'room' | 'table') {
  const [t] = await db.admin<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1, $2, $3) returning qr_token`, [w.A.rid, `${kind} ${randomUUID().slice(0, 6)}`, kind]);
  const o = await placeOrder(db, w.A, { token: t!.qr_token }, [{ item_id: w.A.chai, qty: 1 }]);
  return (await db.admin<{ pay_method: string | null }>(`select pay_method from public.orders where order_no = $1 and restaurant_id = $2`, [o.order_no, w.A.rid]))[0]!.pay_method;
}
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, true)`, [w.A.rid]);
});
afterAll(async () => db.close());

describe('auto bill to the room', () => {
  it('only the owner or manager can switch it; reception, kitchen and strangers cannot; null is refused', async () => {
    expect((await setErr(w.A.waiter, true))?.code).toBe('GM011');
    expect((await setErr(w.A.kitchen, true))?.code).toBe('GM011');
    expect((await setErr(w.stranger, true))?.code).toBe('GM011');
    expect((await setErr(w.A.owner, null))?.code).toBe('GM015');
    expect(await set(w.A.manager, false)).toEqual({ auto_room_bill: false });
  });
  it('off: the guest is asked (no choice yet). On: a room order is put on the room receipt at once, a table order is not', async () => {
    expect(await order('room')).toBeNull();
    expect(await set(w.A.owner, true)).toEqual({ auto_room_bill: true });
    expect(await order('room')).toBe('room_bill');
    expect(await order('table')).toBeNull();
    const s = await db.as('authenticated', w.A.owner, `select public.padh_manage_settings() as r`, [] as never);
    expect((s[0]!.r as any).auto_room_bill).toBe(true);
    await set(w.A.owner, false);
    expect(await order('room')).toBeNull();
  });
});
