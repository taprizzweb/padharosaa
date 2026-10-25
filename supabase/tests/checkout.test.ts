import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, type World } from './helpers/fixtures';

// "Room 102 has checked out": the guest is signed out everywhere, and the room's old menu link stops working (migration 0052).
let db: TestDb;
let w: World;
let room: string;
let session: string;
let token: string;
const call = (fn: string, n: number) => `select public.${fn}(${Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',')}) as r`;
const svc = async <T = any>(fn: string, a: unknown[]): Promise<T> => (await db.as('service_role', null, call(fn, a.length), a as never))[0]!.r as T;
const staff = async <T = any>(uid: string, fn: string, a: unknown[]): Promise<T> => (await db.as('authenticated', uid, call(fn, a.length), a as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, a: unknown[]) => db.asErr('authenticated', uid, call(fn, a.length), a as never);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await svc('padh_admin_enable_hotel', [w.admin, w.A.rid, 'Asia/Kolkata']);
  room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'102') returning id`, [w.A.rid]))[0]!.id;
  session = (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Anita','+91','\\x01','\\x02',$3,'active') returning id`, [w.A.rid, room, Buffer.from(randomUUID())]))[0]!.id;
  token = (await db.admin<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1,'Room 102','room') returning qr_token`, [w.A.rid]))[0]!.qr_token;
});
afterAll(async () => db.close());

describe('room check-out', () => {
  it('reception, the manager and the owner may check a room out; a stranger or another hotel may not', async () => {
    expect((await staffErr(w.stranger, 'padh_checkout_room', [room]))?.code).toBe('GM011');
    expect((await staffErr(w.B.owner, 'padh_checkout_room', [room]))?.code).toMatch(/GM011|GM012/);
    expect((await staffErr(w.A.kitchen, 'padh_checkout_room', [room]))?.code).toBe('GM011');
    expect((await db.asErr('anon', null, `select public.padh_checkout_room($1)`, [room]))?.code).toBe('42501');
    expect((await db.admin<any>(`select status from public.guest_sessions where id = $1`, [session]))[0].status).toBe('active');
  });

  it('the guest is signed out at once, the room link changes, the next guest is not affected, and it is logged', async () => {
    // before: the room's menu link orders fine
    const before = await placeOrder(db, w.A, { token }, [{ item_id: w.A.chai, qty: 1 }]);
    expect(before.order_id).toBeTruthy();
    const r = await staff<any>(w.A.waiter, 'padh_checkout_room', [room]);
    expect(r).toMatchObject({ room: '102', sessions_ended: 1 });
    expect((await db.admin<any>(`select status from public.guest_sessions where id = $1`, [session]))[0].status).toBe('ended');
    // the old link no longer orders: a saved link or an open tab cannot be used for pranks
    const newToken = (await db.admin<{ qr_token: string }>(`select qr_token from public.dining_tables where restaurant_id = $1 and label = 'Room 102'`, [w.A.rid]))[0]!.qr_token;
    expect(newToken).not.toBe(token);
    expect(newToken).toMatch(/^[0-9a-f]{64}$/);
    const e = await db.asErr('service_role', null, `select public.guest_place_order($1, $2, $3::jsonb, null, $4, null)`, [w.A.slug, token, JSON.stringify([{ item_id: w.A.chai, qty: 1 }]), randomUUID()]);
    expect(e?.code).toBe('GM002');
    // the next guest simply gets the new link and orders
    const next = await placeOrder(db, w.A, { token: newToken }, [{ item_id: w.A.chai, qty: 1 }]);
    expect(next.order_id).toBeTruthy();
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where restaurant_id = $1 and action = 'padh_room_checkout' and details ->> 'room' = '102'`, [w.A.rid]))[0].n).toBe(1);
    // checking out an empty room is fine and ends nothing
    expect((await staff<any>(w.A.manager, 'padh_checkout_room', [room])).sessions_ended).toBe(0);
  });
});
