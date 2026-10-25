import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Assigning requests to a person (migration 0056): reception hands over, the owner sets who gets a team's requests directly, and each person sees what is theirs.
let db: TestDb;
let w: World;
let hk1: string; // housekeeping department
let hk2: string; // housekeeping department
let eng: string; // maintenance department
let session: string;
const call = (fn: string, n: number) => `select public.${fn}(${Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',')}) as r`;
const staff = async <T = any>(uid: string, fn: string, a: unknown[] = []): Promise<T> => (await db.as('authenticated', uid, call(fn, a.length), a as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, a: unknown[] = []) => db.asErr('authenticated', uid, call(fn, a.length), a as never);
const create = async (type: string, label: string) => (await db.as('service_role', null, `select public.padh_guest_create_request($1,$2,$3,null,false,$4) as r`, [session, type, label, randomUUID()] as never))[0]!.r as { request_id: string; version: number };
const row = async (id: string) => (await db.admin<any>(`select * from public.requests where id = $1`, [id]))[0];
const seen = async (uid: string) => (await db.as<{ id: string }>('authenticated', uid, `select id from public.requests`)).map((r) => r.id);
async function person(name: string, dept: string, role = 'waiter') {
  const id = randomUUID();
  await db.admin(`insert into auth.users (id, email) values ($1,$2)`, [id, `${name}-${id.slice(0, 6)}@test.local`]);
  await db.admin(`insert into public.staff (user_id, restaurant_id, role, display_name) values ($1,$2,$3,$4)`, [id, w.A.rid, role, name]);
  await db.admin(`insert into public.staff_profiles (user_id, restaurant_id, department) values ($1,$2,$3)`, [id, w.A.rid, dept]);
  return id;
}
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, is_mock) values ($1, true)`, [w.A.rid]);
  hk1 = await person('Ramesh', 'housekeeping');
  hk2 = await person('Suresh', 'housekeeping');
  eng = await person('Mahesh', 'maintenance');
  const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'301') returning id`, [w.A.rid]))[0]!.id;
  session = (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Anita','+91','\\x01','\\x02',$3,'active') returning id`, [w.A.rid, room, Buffer.from(randomUUID())]))[0]!.id;
});
afterAll(async () => db.close());

describe('handing a request to a person', () => {
  it('reception hands a housekeeping request to Ramesh: Ramesh sees and handles it, Suresh (same team) no longer sees it, reception still does', async () => {
    const q = await create('housekeeping', 'Towels');
    expect(await seen(hk2)).toContain(q.request_id);
    const r = await staff(w.A.waiter, 'padh_request_assign', [q.request_id, q.version, hk1]);
    expect(r).toMatchObject({ assigned_to: hk1, assigned_name: 'Ramesh', version: q.version + 1 });
    expect(await seen(hk1)).toContain(q.request_id);
    expect(await seen(hk2)).not.toContain(q.request_id);
    expect(await seen(w.A.waiter)).toContain(q.request_id);
    expect(await seen(w.A.manager)).toContain(q.request_id);
    // Suresh cannot act on it; Ramesh can accept it
    expect((await staffErr(hk2, 'padh_accept', [q.request_id, q.version + 1]))?.code).toBe('GM011');
    expect(await staff(hk1, 'padh_accept', [q.request_id, q.version + 1])).toBeTruthy();
    expect((await db.admin<any>(`select action from public.request_events where request_id = $1 and action = 'assigned'`, [q.request_id])).length).toBe(1);
  });
  it('a person from another department can be given a request, and it shows on their display', async () => {
    const q = await create('housekeeping', 'Broken lamp');
    expect(await seen(eng)).not.toContain(q.request_id);
    await staff(w.A.manager, 'padh_request_assign', [q.request_id, q.version, eng]);
    expect(await seen(eng)).toContain(q.request_id);
    const board = await staff(eng, 'padh_staff_board');
    expect(board.requests.map((x: any) => x.id)).toContain(q.request_id);
    expect(board.requests.find((x: any) => x.id === q.request_id)).toMatchObject({ assigned_name: 'Mahesh' });
  });
  it('only reception, manager and owner hand over; housekeeping and kitchen cannot; a stale version, a stranger as target and a finished request are refused; null gives it back to the team', async () => {
    const q = await create('housekeeping', 'Pillows');
    expect((await staffErr(hk1, 'padh_request_assign', [q.request_id, q.version, hk2]))?.code).toBe('GM011');
    expect((await staffErr(w.A.kitchen, 'padh_request_assign', [q.request_id, q.version, hk2]))?.code).toBe('GM011');
    expect((await staffErr(w.A.waiter, 'padh_request_assign', [q.request_id, q.version + 5, hk1]))?.code).toBe('GM019');
    expect((await staffErr(w.A.waiter, 'padh_request_assign', [q.request_id, q.version, w.stranger]))?.code).toBe('GM015');
    expect((await staffErr(w.A.waiter, 'padh_request_assign', [q.request_id, q.version, w.A.kitchen]))?.code).toBe('GM015');
    const a = await staff(w.A.waiter, 'padh_request_assign', [q.request_id, q.version, hk1]);
    const back = await staff(w.A.waiter, 'padh_request_assign', [q.request_id, a.version, null]);
    expect(back.assigned_to).toBeNull();
    expect(await seen(hk2)).toContain(q.request_id);
    await db.admin(`update public.requests set status = 'completed' where id = $1`, [q.request_id]);
    expect((await staffErr(w.A.waiter, 'padh_request_assign', [q.request_id, back.version, hk1]))?.code).toBe('GM010');
  });
  it('the list of people is for reception, manager and owner only, and names no one from another hotel', async () => {
    const list = await staff(w.A.waiter, 'padh_assignees');
    expect(list.map((p: any) => p.name)).toEqual(expect.arrayContaining(['Ramesh', 'Suresh', 'Mahesh']));
    expect(list.map((p: any) => p.role)).not.toContain('kitchen');
    expect((await staffErr(hk1, 'padh_assignees'))?.code).toBe('GM011');
    expect((await staffErr(w.B.owner, 'padh_assignees'))?.code).toBe('GM011'); // hotel B is not a hotel
  });
});

describe('routing: a team\'s requests go straight to one person', () => {
  it('owner or manager sets it; a new request of that team is Ramesh\'s at once; passing it to another team re-routes; clearing it stops it', async () => {
    expect((await staffErr(w.A.waiter, 'padh_routing_set', ['housekeeping', hk1]))?.code).toBe('GM011');
    expect((await staffErr(w.A.owner, 'padh_routing_set', ['housekeeping', w.A.kitchen]))?.code).toBe('GM015');
    expect((await staffErr(w.A.owner, 'padh_routing_set', ['nonsense', hk1]))?.code).toBe('GM015');
    await staff(w.A.owner, 'padh_routing_set', ['housekeeping', hk1]);
    expect(await staff(w.A.manager, 'padh_routing_get')).toEqual({ housekeeping: hk1 });
    const q = await create('housekeeping', 'Extra bed');
    expect((await row(q.request_id)).assigned_to).toBe(hk1);
    expect(await seen(hk2)).not.toContain(q.request_id);
    expect(await seen(hk1)).toContain(q.request_id);
    // passed on to maintenance: no routing there, so it is the team's again
    await db.admin(`update public.requests set team = 'maintenance' where id = $1`, [q.request_id]);
    expect((await row(q.request_id)).assigned_to).toBeNull();
    // a deactivated person gets nothing
    await db.admin(`update public.staff set active = false where user_id = $1`, [hk1]);
    const q2 = await create('housekeeping', 'Blanket');
    expect((await row(q2.request_id)).assigned_to).toBeNull();
    await db.admin(`update public.staff set active = true where user_id = $1`, [hk1]);
    await staff(w.A.owner, 'padh_routing_set', ['housekeeping', null]);
    const q3 = await create('housekeeping', 'Slippers');
    expect((await row(q3.request_id)).assigned_to).toBeNull();
  });
});

describe('live rooms', () => {
  it('shows each room with a guest, its open requests, open orders and the amount not settled; staff of one team cannot open it', async () => {
    const t = (await db.admin<{ id: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1,'Room 301','room') returning id`, [w.A.rid]))[0]!.id;
    const ts = (await db.admin<{ id: string }>(`insert into public.table_sessions (restaurant_id, table_id) values ($1,$2) returning id`, [w.A.rid, t]))[0]!.id;
    await db.admin(`insert into public.orders (restaurant_id, table_id, session_id, order_no, status, total_paise, idempotency_key) select $1,$2,$3,coalesce(max(order_no),0)+1,'placed',45000,$4 from public.orders where restaurant_id = $1`, [w.A.rid, t, ts, randomUUID()]);
    const rooms = await staff(w.A.waiter, 'padh_live_rooms');
    const r = rooms.find((x: any) => x.number === '301');
    expect(r).toMatchObject({ guest_name: 'Anita', guests: 1 });
    expect(r.open_requests).toBeGreaterThan(0);
    expect(r).toMatchObject({ open_orders: 1, unpaid_paise: 45000, mobile_enc: '01' }); // the number comes back encrypted; the app decrypts it for reception only
    expect((await staffErr(hk1, 'padh_live_rooms'))?.code).toBe('GM011');
    expect((await staffErr(w.A.kitchen, 'padh_live_rooms'))?.code).toBe('GM011');
  });
});
