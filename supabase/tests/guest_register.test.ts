import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// The guest register (migration 0079): who was in the hotel each day, who arrived or left, and what each guest asked for that day.
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
const day = async (n: number) => (await db.admin<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date + $1::int, 'YYYY-MM-DD') as d`, [n]))[0]!.d;
let room: string;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, true)`, [w.A.rid]);
  room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'501') returning id`, [w.A.rid]))[0]!.id;
});
afterAll(async () => db.close());

describe('guest register', () => {
  it('lists the guest on the day of arrival and on every day of the stay, with what he asked for that day', async () => {
    const s = await asU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Anil Kumar','98765 43210','aadhaar','4321',2,null,null,null,null,100000,$2::date,0,null) as r`, [room, await day(2)]);
    // he arrived two days ago, and complained about the AC yesterday
    await db.admin(`update public.stays set check_in_at = now() - interval '2 days' where id = $1`, [s.stay_id]);
    const [gs] = await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash) values ($1,$2,'Anil Kumar','+91','\\x01','\\x02','\\x03') returning id`, [w.A.rid, room]);
    await db.admin(`insert into public.requests (restaurant_id, session_id, room_id, type, team, label, detail, created_at) values ($1,$2,$3,'help','manager','AC is not cooling','tried twice', now() - interval '1 day')`, [w.A.rid, gs!.id, room]);
    const r = await asU(w.A.waiter, `select public.padh_guest_register($1::date,$2::date) as r`, [await day(-3), await day(0)]);
    expect(r.days.map((d: any) => [d.day, d.arrivals, d.in_hotel])).toEqual([[await day(-3), 0, 0], [await day(-2), 1, 1], [await day(-1), 0, 1], [await day(0), 0, 1]]);
    expect(r.days[1].guests[0]).toMatchObject({ room: '501', name: 'Anil Kumar', id_type: 'aadhaar', id_last4: '4321', arrived: true, left: false, requests: [] });
    expect(r.days[2].guests[0].requests).toMatchObject([{ label: 'AC is not cooling', detail: 'tried twice', status: 'received' }]);
  });
  it('shows a guest who has left on his last day only, with the invoice total; reception can read it, a kitchen user cannot; a range over 31 days is refused', async () => {
    const [st] = await db.admin<{ id: string }>(`select id from public.stays where restaurant_id = $1 limit 1`, [w.A.rid]);
    await db.admin(`update public.stays set status = 'checked_out', checked_out_at = now() - interval '1 day', check_out_on = (now() at time zone 'Asia/Kolkata')::date - 1 where id = $1`, [st!.id]);
    const r = await asU(w.A.manager, `select public.padh_guest_register($1::date,$2::date) as r`, [await day(-2), await day(0)]);
    expect(r.days.map((d: any) => d.in_hotel)).toEqual([1, 1, 0]);
    expect(r.days[1].guests[0]).toMatchObject({ left: true, arrived: false });
    expect((await errU(w.A.kitchen, `select public.padh_guest_register($1::date,$2::date)`, [await day(-1), await day(0)]))?.code).toBe('GM011');
    expect((await errU(w.A.waiter, `select public.padh_guest_register($1::date,$2::date)`, [await day(-40), await day(0)]))?.code).toBe('GM015');
  });
});
