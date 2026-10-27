import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, type World } from './helpers/fixtures';

// Push notifications to staff (migration 0068): who is told about a new request or food order, and who is not.
let db: TestDb;
let w: World;
let hk1: string; let hk2: string; let eng: string; let otherHotel: string;
let session: string;
const sub = (n: string) => JSON.stringify({ endpoint: `https://push.example.com/send/${n}-${'x'.repeat(30)}`, keys: { p256dh: `BPlaceholderKey${n}${'k'.repeat(40)}`, auth: `authsecret${n}` } });
const on = async (uid: string, n: string) => (await db.as('authenticated', uid, `select public.padh_staff_push_set($1, null) as r`, [sub(n)] as never))[0]!.r as { on: boolean };
const onErr = (uid: string, text: string | null, ep: string | null = null) => db.asErr('authenticated', uid, `select public.padh_staff_push_set($1, $2)`, [text, ep] as never);
const create = async (type: string, label: string, urgent = false) => (await db.as('service_role', null, `select public.padh_guest_create_request($1,$2,$3,null,$4,$5) as r`, [session, type, label, urgent, randomUUID()] as never))[0]!.r as { request_id: string; version: number };
const forRequest = async (id: string) => (await db.as('service_role', null, `select public.padh_staff_push_for_request($1) as r`, [id] as never))[0]!.r as any;
const who = async (note: any): Promise<string[]> => {
  const ids = (note.targets as { id: string }[]).map((t) => t.id);
  if (ids.length === 0) return [];
  return (await db.admin<{ u: string }>(`select user_id::text as u from public.staff_push where id = any($1::uuid[])`, [ids])).map((r) => r.u);
};
async function person(rid: string, name: string, dept: string | null, role = 'waiter') {
  const id = randomUUID();
  await db.admin(`insert into auth.users (id, email) values ($1,$2)`, [id, `${name}-${id.slice(0, 6)}@test.local`]);
  await db.admin(`insert into public.staff (user_id, restaurant_id, role, display_name) values ($1,$2,$3,$4)`, [id, rid, role, name]);
  if (dept) await db.admin(`insert into public.staff_profiles (user_id, restaurant_id, department) values ($1,$2,$3)`, [id, rid, dept]);
  return id;
}
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, is_mock, enabled) values ($1, true, true)`, [w.A.rid]);
  await db.admin(`insert into public.hotel_settings (restaurant_id, is_mock, enabled) values ($1, true, true)`, [w.B.rid]);
  hk1 = await person(w.A.rid, 'Ramesh', 'housekeeping');
  hk2 = await person(w.A.rid, 'Suresh', 'housekeeping');
  eng = await person(w.A.rid, 'Mahesh', 'maintenance');
  otherHotel = await person(w.B.rid, 'Outsider', 'housekeeping');
  const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'301') returning id`, [w.A.rid]))[0]!.id;
  session = (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Anita','+91','\\x01','\\x02',$3,'active') returning id`, [w.A.rid, room, Buffer.from(randomUUID() + randomUUID()).subarray(0, 32)]))[0]!.id;
  for (const [uid, n] of [[w.A.owner, 'o'], [w.A.manager, 'm'], [w.A.waiter, 'r'], [w.A.kitchen, 'k'], [hk1, 'h1'], [hk2, 'h2'], [eng, 'e'], [otherHotel, 'x']] as const) await on(uid, n);
});
afterAll(async () => db.close());

describe('switching a device on and off', () => {
  it('only a real subscription is stored; strangers cannot; off switches it off and on again switches it back', async () => {
    expect((await onErr(w.stranger, sub('s')))?.code).toBe('GM011');
    for (const bad of ['not json', '{}', JSON.stringify({ endpoint: 'http://insecure.example.com/xxxxxxxxxxxxxxxxxxxx', keys: { p256dh: 'k'.repeat(30), auth: 'a'.repeat(10) } }), JSON.stringify({ endpoint: 'https://push.example.com/send/abcdefghijklmnop', keys: { p256dh: 'short', auth: 'a'.repeat(10) } })]) {
      expect((await onErr(w.A.waiter, bad))?.code, bad).toBe('GM015');
    }
    expect((await onErr(w.A.waiter, null, null))?.code).toBe('GM015'); // off needs to say which device
    const ep = JSON.parse(sub('r')).endpoint as string;
    expect((await db.as('authenticated', w.A.waiter, `select public.padh_staff_push_set(null, $1) as r`, [ep] as never))[0]!.r).toEqual({ on: false });
    expect((await db.admin<{ active: boolean }>(`select active from public.staff_push where endpoint = $1`, [ep]))[0]!.active).toBe(false);
    expect((await on(w.A.waiter, 'r')).on).toBe(true);
    expect((await db.admin<{ active: boolean }>(`select active from public.staff_push where endpoint = $1`, [ep]))[0]!.active).toBe(true);
    // somebody else cannot switch off a device that is not theirs
    await db.as('authenticated', w.A.manager, `select public.padh_staff_push_set(null, $1) as r`, [ep] as never);
    expect((await db.admin<{ active: boolean }>(`select active from public.staff_push where endpoint = $1`, [ep]))[0]!.active).toBe(true);
  });
  it('one person has at most ten devices', async () => {
    for (let i = 0; i < 9; i++) await on(eng, `many${i}`); // eng already has one
    expect((await onErr(eng, sub('many-extra')))?.code).toBe('GM006');
  });
});

describe('who is told about a request', () => {
  it('a housekeeping request: owner, manager, reception and the housekeeping team; not the kitchen, not another department, not another hotel', async () => {
    const q = await create('housekeeping', 'Extra towels');
    const note = await forRequest(q.request_id);
    expect(note).toMatchObject({ room: '301', team: 'housekeeping', label: 'Extra towels', urgent: false });
    const got = new Set(await who(note));
    for (const u of [w.A.owner, w.A.manager, w.A.waiter, hk1, hk2]) expect(got.has(u), u).toBe(true);
    for (const u of [w.A.kitchen, eng, otherHotel]) expect(got.has(u), u).toBe(false);
  });
  it('someone who muted the team in "My alerts" is not told', async () => {
    await db.as('authenticated', hk2, `select public.padh_set_my_alert('housekeeping', true) as r`, [] as never);
    const note = await forRequest((await create('housekeeping', 'Towels again')).request_id);
    const got = new Set(await who(note));
    expect(got.has(hk2)).toBe(false);
    expect(got.has(hk1)).toBe(true);
    await db.as('authenticated', hk2, `select public.padh_set_my_alert('housekeeping', false) as r`, [] as never);
  });
  it('a request given to one person goes to that person and to reception, manager and owner; the rest of the team is left alone', async () => {
    const q = await create('housekeeping', 'Clean the room');
    await db.as('authenticated', w.A.waiter, `select public.padh_request_assign($1,$2,$3) as r`, [q.request_id, q.version, hk1] as never);
    const got = new Set(await who(await forRequest(q.request_id)));
    for (const u of [hk1, w.A.waiter, w.A.manager, w.A.owner]) expect(got.has(u), u).toBe(true);
    expect(got.has(hk2)).toBe(false);
  });
  it('an urgent request says so; a device that was switched off is never a target; the function is not open to signed-in staff', async () => {
    const note = await forRequest((await create('help', 'AC not working', true)).request_id);
    expect(note.urgent).toBe(true);
    const ep = JSON.parse(sub('h1')).endpoint as string;
    await db.as('authenticated', hk1, `select public.padh_staff_push_set(null, $1) as r`, [ep] as never);
    const got = new Set(await who(await forRequest((await create('housekeeping', 'More soap')).request_id)));
    expect(got.has(hk1)).toBe(false);
    expect((await db.asErr('authenticated', w.A.owner, `select public.padh_staff_push_for_request($1)`, [note.id] as never))?.code).toBe('42501');
    expect(await forRequest(randomUUID())).toBeNull();
  });
});

describe('who is told about a food order from a room', () => {
  it('the kitchen, reception, manager and owner; not housekeeping; a table order or an unknown restaurant tells nobody', async () => {
    const [t] = await db.admin<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1, 'Room 301', 'room') returning qr_token`, [w.A.rid]);
    const o = await placeOrder(db, w.A, { token: t!.qr_token }, [{ item_id: w.A.chai, qty: 1 }]);
    const note = (await db.as('service_role', null, `select public.padh_staff_push_for_order($1,$2) as r`, [w.A.slug, o.order_no] as never))[0]!.r as any;
    expect(note).toMatchObject({ room: '301', type: 'order', team: 'kitchen' });
    const got = new Set(await who(note));
    for (const u of [w.A.kitchen, w.A.waiter, w.A.manager, w.A.owner]) expect(got.has(u), u).toBe(true);
    for (const u of [hk1, hk2, eng, otherHotel]) expect(got.has(u), u).toBe(false);
    const [tt] = await db.admin<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1, 'Table 5', 'table') returning qr_token`, [w.A.rid]);
    const o2 = await placeOrder(db, w.A, { token: tt!.qr_token }, [{ item_id: w.A.chai, qty: 1 }]);
    expect((await db.as('service_role', null, `select public.padh_staff_push_for_order($1,$2) as r`, [w.A.slug, o2.order_no] as never))[0]!.r).toBeNull();
    expect((await db.as('service_role', null, `select public.padh_staff_push_for_order($1,$2) as r`, ['no-such-hotel', 1] as never))[0]!.r).toBeNull();
  });
});
