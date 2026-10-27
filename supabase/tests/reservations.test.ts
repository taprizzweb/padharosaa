import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Reservations, the room chart, housekeeping status and search (migration 0071).
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
const day = async (n: number) => (await db.admin<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date + $1::int, 'YYYY-MM-DD') as d`, [n]))[0]!.d;
const room: Record<string, string> = {};

const book = async (uid: string, o: { room?: string | null; type?: string | null; guest?: string; from?: number; to?: number; rate?: number | null; adv?: number; mode?: string | null; id?: string | null } = {}) =>
  asU(uid, `select public.padh_reservation_save($1::uuid,$2::uuid,$3::uuid,$4,'98765 43210',2,$5::date,$6::date,$7::int,$8::int,$9,'Phone','near the lift') as r`,
    [o.id ?? null, o.room ?? null, o.type ?? null, o.guest ?? 'Anita Rao', await day(o.from ?? 1), await day(o.to ?? 3), o.rate === undefined ? 300000 : o.rate, o.adv ?? 0, o.mode ?? null]);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, true)`, [w.A.rid]);
  for (const no of ['301', '302', '303']) room[no] = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) returning id`, [w.A.rid, no]))[0]!.id;
});
afterAll(async () => db.close());

describe('reservations', () => {
  it('only the front office can book; the kitchen and strangers cannot', async () => {
    for (const uid of [w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_reservations_list('upcoming')`))?.code).toBe('GM011');
  });
  it('a booking gets the next number of the hotel; dates and amounts are checked', async () => {
    const a = await book(w.A.waiter, { room: room['301'] });
    const b = await book(w.A.manager, { room: room['302'], guest: 'Dev Patel' });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    const bad = [{ from: 3, to: 3 }, { from: -2, to: 1 }, { from: 1, to: 200 }, { rate: -5 }, { adv: 5000, mode: null }, { rate: null }];
    for (const o of bad) await expect(book(w.A.waiter, o as never)).rejects.toMatchObject({ code: 'GM015' });
  });
  it('one room cannot be promised twice for the same nights, but back to back is fine', async () => {
    expect((await errU(w.A.waiter, `select public.padh_reservation_save(null,$1::uuid,null,'Clash',null,1,$2::date,$3::date,300000,0,null,null,null)`, [room['301'], await day(2), await day(4)]))?.code).toBe('GM019');
    await book(w.A.waiter, { room: room['301'], guest: 'Next Guest', from: 3, to: 5 });
  });
  it('a hotel cannot book another hotel\'s room', async () => {
    const [other] = await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'901') returning id`, [w.B.rid]);
    expect((await errU(w.A.waiter, `select public.padh_reservation_save(null,$1::uuid,null,'Mallory',null,1,$2::date,$3::date,300000,0,null,null,null)`, [other!.id, await day(1), await day(2)]))?.code).toBe('GM012');
  });
  it('lists: upcoming, then cancelling moves it to past; an advance needs a payment mode', async () => {
    const up = await asU(w.A.waiter, `select public.padh_reservations_list('upcoming') as r`);
    expect(up.map((x: any) => x.guest_name)).toEqual(expect.arrayContaining(['Anita Rao', 'Dev Patel']));
    const dev = up.find((x: any) => x.guest_name === 'Dev Patel');
    await asU(w.A.waiter, `select public.padh_reservation_close($1::uuid,'cancelled','changed plans') as r`, [dev.id]);
    expect((await asU(w.A.waiter, `select public.padh_reservations_list('past') as r`)).map((x: any) => x.status)).toContain('cancelled');
    expect((await errU(w.A.waiter, `select public.padh_reservation_close($1::uuid,'cancelled',null)`, [dev.id]))?.code).toBe('GM012'); // already closed
    expect((await errU(w.A.waiter, `select public.padh_reservation_close($1::uuid,'bogus',null)`, [dev.id]))?.code).toBe('GM015');
    // the freed room can be booked again
    await book(w.A.waiter, { room: room['302'], guest: 'Replacement', adv: 100000, mode: 'upi' });
  });
});

describe('check in from a booking', () => {
  let arrival: string;
  it('a booking for tomorrow cannot be checked in today; one for today becomes a stay with the advance as the first payment', async () => {
    const tomorrow = (await asU(w.A.waiter, `select public.padh_reservations_list('upcoming') as r`)).find((x: any) => x.guest_name === 'Anita Rao');
    expect((await errU(w.A.waiter, `select public.padh_reservation_checkin($1::uuid,null,null,null,null,null,null)`, [tomorrow.id]))?.code).toBe('GM015');
    const r = await book(w.A.waiter, { room: room['303'], guest: 'Walk Today', from: 0, to: 2, adv: 100000, mode: 'cash' });
    arrival = r.id;
    expect((await asU(w.A.waiter, `select public.padh_reservations_list('today') as r`)).map((x: any) => x.guest_name)).toEqual(['Walk Today']);
    const out = await asU(w.A.waiter, `select public.padh_reservation_checkin($1::uuid,null,'aadhaar','1234',null,null,null) as r`, [arrival]);
    expect(out.room).toBe('303');
    expect(out.stay_code).toMatch(/^[0-9]{4}$/);
    const [pay] = await db.admin<{ amount_paise: number; kind: string }>(`select amount_paise, kind from public.stay_payments where stay_id = $1`, [out.stay_id]);
    expect(pay).toEqual({ amount_paise: 100000, kind: 'advance' });
    expect((await db.admin<{ status: string; stay_id: string }>(`select status, stay_id from public.reservations where id = $1`, [arrival]))[0]).toEqual({ status: 'checked_in', stay_id: out.stay_id });
    expect((await errU(w.A.waiter, `select public.padh_reservation_checkin($1::uuid,null,null,null,null,null,null)`, [arrival]))?.code).toBe('GM012'); // only once
  });
  it('a booking with only a room type needs a room at check-in', async () => {
    const t = (await db.admin<{ id: string }>(`insert into public.room_types (restaurant_id, name, rate_paise) values ($1,'Deluxe',300000) returning id`, [w.A.rid]))[0]!.id;
    const r = await book(w.A.waiter, { type: t, guest: 'Type Only', from: 0, to: 1, rate: null });
    expect((await errU(w.A.waiter, `select public.padh_reservation_checkin($1::uuid,null,null,null,null,null,null)`, [r.id]))?.code).toBe('GM015');
    const out = await asU(w.A.waiter, `select public.padh_reservation_checkin($1::uuid,$2::uuid,null,null,null,null,null) as r`, [r.id, room['301']]);
    expect(out.room).toBe('301');
  });
});

describe('room chart and housekeeping', () => {
  it('the chart lists every room, a bar for each guest and booking, and the day numbers', async () => {
    const c = await asU(w.A.waiter, `select public.padh_room_chart(null, 14) as r`);
    expect(c.rooms.map((r: any) => r.number)).toEqual(expect.arrayContaining(['301', '302', '303']));
    expect(c.bars.filter((b: any) => b.kind === 'stay').length).toBe(2);
    expect(c.summary.in_house).toBe(2);
    expect(c.rooms.find((r: any) => r.number === '303').occupied).toBe(true);
    expect((await errU(w.A.waiter, `select public.padh_room_chart(null, 90)`))?.code).toBe('GM015');
    for (const uid of [w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_room_chart(null, 7)`))?.code).toBe('GM011');
  });
  it('checking a guest out leaves the room dirty; reception marks it clean; a room with a guest cannot go out of order', async () => {
    const [stay] = await db.admin<{ id: string }>(`select id from public.stays where room_id = $1 and status = 'in_house'`, [room['303']]);
    await db.admin(`update public.stay_payments set amount_paise = amount_paise where stay_id = $1`, [stay!.id]);
    await asU(w.A.waiter, `select public.padh_payment_add($1::uuid,'payment','cash',(select (private.folio_calc($1::uuid, true)->>'balance_paise')::int),null) as r`, [stay!.id]).catch(() => null);
    expect((await errU(w.A.waiter, `select public.padh_room_hk_set($1::uuid,'out_of_order','broken')`, [room['303']]))?.code).toBe('GM019');
    await db.admin(`update public.stays set status = 'checked_out', checked_out_at = now() where id = $1`, [stay!.id]);
    expect((await db.admin<{ hk_status: string }>(`select hk_status from public.rooms where id = $1`, [room['303']]))[0]!.hk_status).toBe('dirty');
    await asU(w.A.waiter, `select public.padh_room_hk_set($1::uuid,'cleaning',null) as r`, [room['303']]);
    await asU(w.A.waiter, `select public.padh_room_hk_set($1::uuid,'clean',null) as r`, [room['303']]);
    expect((await db.admin<{ hk_status: string }>(`select hk_status from public.rooms where id = $1`, [room['303']]))[0]!.hk_status).toBe('clean');
    await asU(w.A.manager, `select public.padh_room_hk_set($1::uuid,'out_of_order','AC repair') as r`, [room['303']]);
    expect((await errU(w.A.waiter, `select public.padh_reservation_save(null,$1::uuid,null,'Blocked',null,1,$2::date,$3::date,100,0,null,null,null)`, [room['303'], await day(1), await day(2)]))?.code).toBe('GM019');
    expect((await errU(w.A.waiter, `select public.padh_room_hk_set($1::uuid,'weird',null)`, [room['303']]))?.code).toBe('GM015');
    expect((await errU(w.stranger, `select public.padh_room_hk_set($1::uuid,'clean',null)`, [room['303']]))?.code).toBe('GM011');
  });
});

describe('search', () => {
  it('finds a guest by name, room or mobile and a booking by number; short or hostile input finds nothing', async () => {
    const byName = await asU(w.A.waiter, `select public.padh_search('walk') as r`);
    expect(byName.map((x: any) => x.title)).toContain('Walk Today');
    expect((await asU(w.A.waiter, `select public.padh_search('301') as r`)).some((x: any) => x.kind === 'stay')).toBe(true);
    expect((await asU(w.A.waiter, `select public.padh_search('B1') as r`)).some((x: any) => x.kind === 'booking' && x.seq === 1)).toBe(true);
    expect((await asU(w.A.waiter, `select public.padh_search('98765') as r`)).length).toBeGreaterThan(0);
    expect(await asU(w.A.waiter, `select public.padh_search('a') as r`)).toEqual([]);
    expect(await asU(w.A.waiter, `select public.padh_search('%') as r`)).toEqual([]);
    expect(await asU(w.A.waiter, `select public.padh_search($1) as r`, ["'; drop table x;--"])).toEqual([]);
    expect((await errU(w.stranger, `select public.padh_search('walk')`))?.code).toBe('GM011');
  });
  it('never shows another hotel\'s guests', async () => {
    await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true) on conflict do nothing`, [w.B.rid]);
    const r = await asU(w.B.owner, `select public.padh_search('walk') as r`).catch(() => []);
    expect(r).toEqual([]);
  });
});
