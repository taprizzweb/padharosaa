import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// The price calendar (migration 0074).
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
const day = async (n: number) => (await db.admin<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date + $1::int, 'YYYY-MM-DD') as d`, [n]))[0]!.d;
let type: string;
const rooms: string[] = [];
const get = (uid = w.A.waiter, days = 31) => asU(uid, `select public.padh_rates_get($1::uuid, null, $2::int) as r`, [type, days]);
const set = async (uid: string, o: { from?: number; to?: number; rate?: number | null; stop?: boolean | null; min?: number | null; wd?: string | null; reset?: boolean }) =>
  asU(uid, `select public.padh_rates_set($1::uuid,$2::date,$3::date,$4::int,$5::boolean,$6::int,$7,$8::boolean) as r`, [type, await day(o.from ?? 0), await day(o.to ?? 0), o.rate ?? null, o.stop ?? null, o.min ?? null, o.wd ?? null, o.reset ?? false]);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.A.rid]);
  type = (await db.admin<{ id: string }>(`insert into public.room_types (restaurant_id, name, rate_paise) values ($1,'Deluxe',300000) returning id`, [w.A.rid]))[0]!.id;
  for (const no of ['501', '502', '503']) rooms.push((await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number, room_type_id) values ($1,$2,$3) returning id`, [w.A.rid, no, type]))[0]!.id);
});
afterAll(async () => db.close());

describe('price calendar', () => {
  it('shows 31 days at the everyday price with all rooms free; reception can read, strangers cannot', async () => {
    const g = await get();
    expect(g.days).toHaveLength(31);
    expect(g.days.every((d: any) => d.rate_paise === 300000 && !d.custom && d.free === 3)).toBe(true);
    expect(g.type).toMatchObject({ name: 'Deluxe', base_paise: 300000, rooms: 3 });
    expect((await errU(w.stranger, `select public.padh_rates_get($1::uuid,null,31)`, [type]))?.code).toBe('GM011');
    expect((await errU(w.A.waiter, `select public.padh_rates_get($1::uuid,null,500)`, [type]))?.code).toBe('GM015');
  });
  it('only the owner and manager change prices', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_rates_set($1::uuid,current_date,current_date,1000,null,null,null,false)`, [type]))?.code).toBe('GM011');
  });
  it('one day, a range, only weekends, stop-sell and a minimum stay; the other days keep the everyday price', async () => {
    await set(w.A.owner, { from: 2, to: 2, rate: 450000 });
    await set(w.A.manager, { from: 5, to: 11, rate: 350000, wd: 'sat,sun' });
    await set(w.A.owner, { from: 20, to: 22, stop: true, min: 2 });
    const g = await get();
    const d = (n: number) => g.days[n];
    expect(d(2)).toMatchObject({ rate_paise: 450000, custom: true });
    const weekend = g.days.filter((x: any) => x.custom && x.rate_paise === 350000).length;
    expect(weekend).toBeGreaterThanOrEqual(2);
    expect(weekend).toBeLessThanOrEqual(3);
    expect(d(3).custom).toBe(false);
    expect(d(21)).toMatchObject({ stop_sell: true, min_stay: 2, rate_paise: 300000 });
    // a rate on a stop-sell day keeps the stop; removing the minimum stay works
    await set(w.A.owner, { from: 21, to: 21, rate: 280000, min: 0 });
    expect((await get()).days[21]).toMatchObject({ stop_sell: true, min_stay: null, rate_paise: 280000 });
  });
  it('resetting puts the days back (the row stays but holds nothing)', async () => {
    await set(w.A.owner, { from: 0, to: 40, reset: true });
    expect((await get()).days.every((x: any) => !x.custom && !x.stop_sell)).toBe(true);
    const live = async () => (await db.admin<{ n: number }>(`select count(*)::int as n from public.room_rates where rate_paise is not null or stop_sell or min_stay is not null`))[0]!.n;
    expect(await live()).toBe(0);
    await set(w.A.owner, { from: 3, to: 3, rate: 123 });
    expect(await live()).toBe(1);
    await set(w.A.owner, { from: 3, to: 3, rate: null, stop: false, reset: true });
    expect(await live()).toBe(0);
  });
  it('bad input is refused: nothing to change, backwards range, bad weekday, negative price, past dates, another hotel\'s type', async () => {
    for (const q of [`current_date,current_date,null,null,null,null,false`, `current_date + 3,current_date,100,null,null,null,false`, `current_date,current_date,100,null,null,'funday',false`, `current_date,current_date,-1,null,null,null,false`, `current_date - 10,current_date,100,null,null,null,false`, `current_date,current_date + 400,100,null,null,null,false`]) {
      expect((await errU(w.A.owner, `select public.padh_rates_set($1::uuid,${q})`, [type]))?.code).toBe('GM015');
    }
    const other = (await db.admin<{ id: string }>(`insert into public.room_types (restaurant_id, name, rate_paise) values ($1,'Other',100) returning id`, [w.B.rid]))[0]!.id;
    expect((await errU(w.A.owner, `select public.padh_rates_set($1::uuid,current_date,current_date,100,null,null,null,false)`, [other]))?.code).toBe('GM012');
  });
  it('free rooms fall with a booking, a guest in the house and a room out of order', async () => {
    await asU(w.A.waiter, `select public.padh_reservation_save(null,null,$1::uuid,'Booked Guest',null,1,$2::date,$3::date,300000,0,null,null,null) as r`, [type, await day(1), await day(3)]);
    const g1 = await get();
    expect(g1.days.map((x: any) => x.free).slice(0, 4)).toEqual([3, 2, 2, 3]);
    await asU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'In Guest',null,null,null,1,null,null,null,null,300000,$2::date,0,null) as r`, [rooms[0], await day(2)]);
    expect((await get()).days.map((x: any) => x.free).slice(0, 4)).toEqual([2, 1, 2, 3]);
    await asU(w.A.manager, `select public.padh_room_hk_set($1::uuid,'out_of_order','leak') as r`, [rooms[2]]);
    expect((await get()).days.map((x: any) => x.free).slice(0, 4)).toEqual([1, 0, 1, 2]);
  });
  it('the price on a day is read for the booking form', async () => {
    await set(w.A.owner, { from: 6, to: 6, rate: 410000 });
    expect((await asU(w.A.waiter, `select public.padh_rate_on($1::uuid,$2::date) as r`, [type, await day(6)])).rate_paise).toBe(410000);
    expect((await asU(w.A.waiter, `select public.padh_rate_on($1::uuid,$2::date) as r`, [type, await day(7)])).rate_paise).toBe(300000);
  });
});
