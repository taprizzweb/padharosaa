import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
const call = (fn: string, n: number) => `select public.${fn}(${Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',')}) as r`;
const staff = async <T = any>(uid: string, fn: string, a: unknown[]): Promise<T> => (await db.as('authenticated', uid, call(fn, a.length), a as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, a: unknown[]) => db.asErr('authenticated', uid, call(fn, a.length), a as never);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const t of [w.A, w.B]) await db.admin(`insert into public.hotel_settings (restaurant_id, is_mock) values ($1, true)`, [t.rid]);
});
afterAll(async () => db.close());

describe('rooms from the manager page', () => {
  it('a manager adds rooms; the list shows them; adding again changes nothing', async () => {
    expect(await staff(w.A.manager, 'padh_rooms_add', [['101', '102', ' 201 a ']])).toMatchObject({ added: 3 });
    expect(await staff(w.A.manager, 'padh_rooms_add', [['101', '102']])).toMatchObject({ added: 0 });
    const list = await staff<any[]>(w.A.waiter, 'padh_rooms_list', []);
    expect(list.map((r) => r.number)).toEqual(['101', '102', '201 A']);
    expect(list.every((r) => r.active && r.guests === 0)).toBe(true);
  });
  it("the hotel's room-service link exists from the start and its room list follows the rooms", async () => {
    const r = async () => (await db.admin<any>(`select room_token, room_numbers from public.restaurants where id = $1`, [w.A.rid]))[0];
    const before = await r();
    expect(before.room_token).toMatch(/^[0-9a-f]{64}$/); // made when Padharosaa was switched on
    expect(before.room_numbers).toEqual(['101', '102', '201 A']);
    await staff(w.A.manager, 'padh_rooms_add', [['103']]);
    expect((await r()).room_numbers).toEqual(['101', '102', '103', '201 A']);
    expect((await r()).room_token).toBe(before.room_token); // the link never changes by itself
    const id = (await staff<any[]>(w.A.manager, 'padh_rooms_list', [])).find((x) => x.number === '103').id;
    await staff(w.A.manager, 'padh_rooms_set_active', [id, false]);
    expect((await r()).room_numbers).toEqual(['101', '102', '201 A']);
    await staff(w.A.manager, 'padh_rooms_add', [['103']]);
    await staff(w.A.manager, 'padh_rooms_set_active', [id, false]);
  });
  it('each hotel sees only its own rooms', async () => {
    await staff(w.B.owner, 'padh_rooms_add', [['B1']]);
    expect((await staff<any[]>(w.A.manager, 'padh_rooms_list', [])).map((r) => r.number)).not.toContain('B1');
    expect((await staff<any[]>(w.B.manager, 'padh_rooms_list', [])).map((r) => r.number)).toEqual(['B1']);
  });
  it('bad numbers, empty lists and too many are refused', async () => {
    for (const bad of [[[]], [['<b>']], [['x'.repeat(11)]], [['1;2']], [[null]], [null]]) expect((await staffErr(w.A.manager, 'padh_rooms_add', bad))?.code, JSON.stringify(bad)).toBe('GM015');
    expect((await staffErr(w.A.manager, 'padh_rooms_add', [Array.from({ length: 101 }, (_, i) => `R${i}`)]))?.code).toBe('GM015');
  });
  it('only owner and manager add or switch rooms; kitchen and strangers cannot even list', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await staffErr(uid, 'padh_rooms_add', [['999']]))?.code, uid).toBe('GM011');
    for (const uid of [w.A.kitchen, w.stranger]) expect((await staffErr(uid, 'padh_rooms_list', []))?.code, uid).toBe('GM011');
    expect((await db.asErr('anon', null, `select public.padh_rooms_list()`))?.code).toBe('42501');
    expect((await db.asErr('service_role', null, `select public.padh_rooms_list()`))?.code).toBe('42501');
  });
  it('switching a room off ends its live guests; another hotel cannot touch it; adding switches it back on', async () => {
    const room = (await staff<any[]>(w.A.manager, 'padh_rooms_list', [])).find((r) => r.number === '101').id;
    const sid = (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash) values ($1,$2,'Guest One','+91','\\x01','\\x02',$3) returning id`, [w.A.rid, room, Buffer.from('tok-' + Math.random())]))[0]!.id;
    expect((await staffErr(w.B.manager, 'padh_rooms_set_active', [room, false]))?.code).toBe('GM012');
    await staff(w.A.manager, 'padh_rooms_set_active', [room, false]);
    expect((await db.admin<any>(`select active from public.rooms where id = $1`, [room]))[0].active).toBe(false);
    expect((await db.admin<any>(`select status from public.guest_sessions where id = $1`, [sid]))[0].status).toBe('ended');
    expect(await staff(w.A.manager, 'padh_rooms_add', [['101']])).toMatchObject({ added: 1 });
    expect((await db.admin<any>(`select active from public.rooms where id = $1`, [room]))[0].active).toBe(true);
    expect((await staffErr(w.A.waiter, 'padh_rooms_set_active', [room, false]))?.code).toBe('GM011');
  });
});
