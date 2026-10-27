import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// The channel manager's data and rules (migration 0075): set-up, the change queue, the sender's claim, and booking-site bookings arriving.
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
const svc = async (sql: string, params: unknown[] = []) => (await db.as('service_role', null, sql, params as never))[0]!.r as any;
const day = async (n: number) => (await db.admin<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date + $1::int, 'YYYY-MM-DD') as d`, [n]))[0]!.d;
const EXT_ROOM = 'aaaaaaaa-1111-2222-3333-444444444444';
const EXT_RATE = 'bbbbbbbb-1111-2222-3333-444444444444';
const PROP = 'cccccccc-1111-2222-3333-444444444444';
let type: string;
const rooms: string[] = [];
const outbox = () => db.admin<{ room_type_id: string; day_from: string; day_to: string; done_at: string | null }>(`select room_type_id, to_char(day_from,'YYYY-MM-DD') as day_from, to_char(day_to,'YYYY-MM-DD') as day_to, done_at from public.channel_outbox order by id`);
const clearOutbox = () => db.admin(`delete from public.channel_outbox`);
const apply = (o: Record<string, unknown>) => svc(`select public.padh_channel_booking_apply($1::uuid,$2) as r`, [w.A.rid, JSON.stringify({ ext_id: 'BK-1#0', revision: 'rev1', status: 'new', channel: 'Booking.com', guest: 'Ravi Kumar', mobile: '+91 98765 00000', adults: 2, check_in: null, check_out: null, ext_room_type_id: EXT_ROOM, rate_paise: 250000, notes: 'Late arrival', ...o })]);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.A.rid]);
  type = (await db.admin<{ id: string }>(`insert into public.room_types (restaurant_id, name, rate_paise) values ($1,'Deluxe',300000) returning id`, [w.A.rid]))[0]!.id;
  for (const no of ['601', '602']) rooms.push((await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number, room_type_id) values ($1,$2,$3) returning id`, [w.A.rid, no, type]))[0]!.id);
});
afterAll(async () => db.close());

describe('set-up', () => {
  it('only the owner and manager see or change it; switching on needs a property and a linked room type', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_channel_get()`))?.code).toBe('GM011');
    expect((await errU(w.A.owner, `select public.padh_channel_save($1,true)`, [PROP]))?.code).toBe('GM015'); // nothing linked yet
    expect((await errU(w.A.owner, `select public.padh_channel_map($1::uuid,'short','x')`, [type]))?.code).toBe('GM015');
    expect((await errU(w.A.owner, `select public.padh_channel_map($1::uuid,$2,null)`, [type, EXT_ROOM]))?.code).toBe('GM015'); // both ids or neither
    await asU(w.A.manager, `select public.padh_channel_map($1::uuid,$2,$3) as r`, [type, EXT_ROOM, EXT_RATE]);
    expect((await errU(w.A.owner, `select public.padh_channel_save('not a valid id!',true)`))?.code).toBe('GM015');
    await asU(w.A.owner, `select public.padh_channel_save($1,true) as r`, [PROP]);
    const g = await asU(w.A.owner, `select public.padh_channel_get() as r`);
    expect(g.link).toMatchObject({ property_id: PROP, enabled: true });
    expect(g.link.webhook_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(g.types[0]).toMatchObject({ name: 'Deluxe', ext_room_type_id: EXT_ROOM, ext_rate_plan_id: EXT_RATE });
    expect(g.waiting).toBeGreaterThan(0); // switching on queues the whole year
  });
  it('one room type at the service cannot be linked to two of ours; another hotel\'s type is refused', async () => {
    const t2 = (await db.admin<{ id: string }>(`insert into public.room_types (restaurant_id, name, rate_paise) values ($1,'Suite',500000) returning id`, [w.A.rid]))[0]!.id;
    expect((await errU(w.A.owner, `select public.padh_channel_map($1::uuid,$2,$3)`, [t2, EXT_ROOM, EXT_RATE]))?.code).toBe('GM019');
    const other = (await db.admin<{ id: string }>(`insert into public.room_types (restaurant_id, name, rate_paise) values ($1,'X',100) returning id`, [w.B.rid]))[0]!.id;
    expect((await errU(w.A.owner, `select public.padh_channel_map($1::uuid,$2,$3)`, [other, 'dddddddd-1111', 'eeeeeeee-1111']))?.code).toBe('GM012');
  });
});

describe('what is queued for the sender', () => {
  it('a price change, a booking, a guest checking in and a room going out of order each queue the days they touch', async () => {
    await clearOutbox();
    await asU(w.A.owner, `select public.padh_rates_set($1::uuid,$2::date,$3::date,350000,null,null,null,false) as r`, [type, await day(3), await day(5)]);
    let o = await outbox();
    expect(o.length).toBeGreaterThan(0);
    expect(o.every((x) => x.room_type_id === type)).toBe(true);
    await clearOutbox();
    await asU(w.A.waiter, `select public.padh_reservation_save(null,null,$1::uuid,'Q Guest',null,1,$2::date,$3::date,300000,0,null,null,null) as r`, [type, await day(10), await day(12)]);
    o = await outbox();
    expect(o).toEqual([{ room_type_id: type, day_from: await day(10), day_to: await day(12), done_at: null }]);
    await clearOutbox();
    await asU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Q Stay',null,null,null,1,null,null,null,null,300000,$2::date,0,null) as r`, [rooms[0], await day(2)]);
    expect((await outbox()).length).toBeGreaterThan(0);
    await clearOutbox();
    await asU(w.A.manager, `select public.padh_room_hk_set($1::uuid,'out_of_order','leak') as r`, [rooms[1]]);
    expect((await outbox()).length).toBe(1);
    await clearOutbox();
    await asU(w.A.manager, `select public.padh_room_hk_set($1::uuid,'dirty',null) as r`, [rooms[1]]); // cleaning status alone changes nothing at the sites... except leaving out of order
    expect((await outbox()).length).toBe(1);
    await clearOutbox();
    await asU(w.A.manager, `select public.padh_room_hk_set($1::uuid,'clean',null) as r`, [rooms[1]]);
    expect(await outbox()).toEqual([]);
  });
  it('nothing is queued for a hotel that has the channel switched off', async () => {
    await asU(w.A.owner, `select public.padh_channel_save($1,false) as r`, [PROP]);
    await clearOutbox();
    await asU(w.A.owner, `select public.padh_rates_set($1::uuid,$2::date,$2::date,360000,null,null,null,false) as r`, [type, await day(6)]);
    expect(await outbox()).toEqual([]);
    await asU(w.A.owner, `select public.padh_channel_save($1,true) as r`, [PROP]);
  });
  it('the sender takes the waiting changes merged per room type, with the final price, closing, minimum stay and free rooms of each day', async () => {
    await clearOutbox();
    await asU(w.A.owner, `select public.padh_rates_set($1::uuid,$2::date,$3::date,420000,true,2,null,false) as r`, [type, await day(20), await day(21)]);
    await asU(w.A.owner, `select public.padh_rates_set($1::uuid,$2::date,$2::date,null,null,null,null,true) as r`, [type, await day(21)]);
    const claim = await svc(`select public.padh_channel_claim(50) as r`);
    expect(claim).toHaveLength(1);
    const c = claim[0];
    expect(c).toMatchObject({ restaurant_id: w.A.rid, room_type_id: type, property_id: PROP, ext_room_type_id: EXT_ROOM, ext_rate_plan_id: EXT_RATE });
    expect(c.from).toBe(await day(20));
    expect(c.days[0]).toMatchObject({ rate_paise: 420000, stop_sell: true, min_stay: 2, free: 2 });
    expect(c.days[1]).toMatchObject({ rate_paise: 300000, stop_sell: false, min_stay: null });
    expect(await svc(`select public.padh_channel_claim(50) as r`)).toEqual([]); // nothing is handed out twice
    await svc(`select public.padh_channel_done($1::uuid,$2,null) as r`, [w.A.rid, JSON.stringify(c.ids)]);
    expect((await outbox()).every((x) => x.done_at !== null)).toBe(true);
  });
  it('a failed send is tried again, and after six tries it shows as failed', async () => {
    await clearOutbox();
    await asU(w.A.owner, `select public.padh_rates_set($1::uuid,$2::date,$2::date,370000,null,null,null,false) as r`, [type, await day(8)]);
    for (let i = 0; i < 6; i++) {
      const c = await svc(`select public.padh_channel_claim(10) as r`);
      expect(c).toHaveLength(1);
      await svc(`select public.padh_channel_done($1::uuid,$2,'service said no') as r`, [w.A.rid, JSON.stringify(c[0].ids)]);
    }
    expect(await svc(`select public.padh_channel_claim(10) as r`)).toEqual([]);
    const g = await asU(w.A.owner, `select public.padh_channel_get() as r`);
    expect(g.failed).toBe(1);
    expect(g.link.last_error).toBe('service said no');
    await asU(w.A.owner, `select public.padh_channel_resync() as r`);
    expect((await asU(w.A.owner, `select public.padh_channel_get() as r`)).failed).toBe(0);
    await clearOutbox();
  });
  it('the staff roles cannot call the sender\'s functions', async () => {
    for (const call of [`select public.padh_channel_claim(5)`, `select public.padh_channel_by_secret('x')`, `select public.padh_channel_pull_due(0)`]) expect((await errU(w.A.owner, call))?.code).toBe('42501');
  });
});

describe('unlinking a room type', () => {
  it('an unlinked type shows empty, sends nothing and takes no bookings; linking it again (even to the same ids) works', async () => {
    await asU(w.A.owner, `select public.padh_channel_map($1::uuid,null,null) as r`, [type]);
    let g = await asU(w.A.owner, `select public.padh_channel_get() as r`);
    expect(g.types.find((t: any) => t.id === type)).toMatchObject({ ext_room_type_id: null, ext_rate_plan_id: null });
    await clearOutbox();
    await asU(w.A.owner, `select public.padh_rates_set($1::uuid,$2::date,$2::date,380000,null,null,null,false) as r`, [type, await day(12)]);
    expect(await outbox()).toEqual([]);
    expect((await apply({ ext_id: 'BK-UL#0', check_in: await day(50), check_out: await day(51) })).action).toBe('unmapped');
    await asU(w.A.owner, `select public.padh_channel_map($1::uuid,$2,$3) as r`, [type, EXT_ROOM, EXT_RATE]);
    g = await asU(w.A.owner, `select public.padh_channel_get() as r`);
    expect(g.types.find((t: any) => t.id === type)).toMatchObject({ ext_room_type_id: EXT_ROOM, ext_rate_plan_id: EXT_RATE });
    expect((await outbox()).length).toBeGreaterThan(0);
    expect((await apply({ ext_id: 'BK-UL#0', check_in: await day(50), check_out: await day(51) })).action).toBe('created');
  });
});

describe('bookings from a booking site', () => {
  it('a new booking becomes a reservation with the site\'s name; sending it again changes nothing; a change moves it; a cancel cancels it', async () => {
    const a = await apply({ check_in: await day(30), check_out: await day(32) });
    expect(a).toMatchObject({ action: 'created', overbooked: false });
    const [r] = await db.admin<any>(`select * from public.reservations where id = $1`, [a.id]);
    expect(r).toMatchObject({ guest_name: 'Ravi Kumar', mobile: '919876500000', adults: 2, rate_paise: 250000, source: 'Booking.com', channel: 'Booking.com', external_ref: 'BK-1#0', status: 'booked' });
    expect((await apply({ check_in: await day(30), check_out: await day(32) })).action).toBe('updated');
    expect((await db.admin<{ n: number }>(`select count(*)::int as n from public.reservations where external_ref = 'BK-1#0'`))[0]!.n).toBe(1);
    await apply({ status: 'modified', check_in: await day(31), check_out: await day(34), guest: 'Ravi K' });
    const [m] = await db.admin<any>(`select guest_name, to_char(check_in_on,'YYYY-MM-DD') as i, to_char(check_out_on,'YYYY-MM-DD') as o from public.reservations where id = $1`, [a.id]);
    expect(m).toEqual({ guest_name: 'Ravi K', i: await day(31), o: await day(34) });
    expect((await apply({ status: 'cancelled' })).action).toBe('cancelled');
    expect((await db.admin<{ status: string; cancel_reason: string }>(`select status, cancel_reason from public.reservations where id = $1`, [a.id]))[0]).toEqual({ status: 'cancelled', cancel_reason: 'Cancelled on Booking.com' });
    expect((await apply({ status: 'cancelled' })).action).toBe('kept');
  });
  it('a booking for a room type that is not linked is reported, not guessed; a bad one is refused', async () => {
    expect((await apply({ ext_id: 'BK-2#0', check_in: await day(5), check_out: await day(6), ext_room_type_id: 'ffffffff-0000-0000-0000-000000000000' })).action).toBe('unmapped');
    await expect(apply({ ext_id: 'BK-3#0', check_in: await day(6), check_out: await day(5) })).rejects.toMatchObject({ code: 'GM015' });
    await expect(apply({ ext_id: '', check_in: await day(5), check_out: await day(6) })).rejects.toMatchObject({ code: 'GM015' });
    await expect(apply({ ext_id: 'BK-4#0', status: 'weird', check_in: await day(5), check_out: await day(6) })).rejects.toMatchObject({ code: 'GM015' });
  });
  it('when no room is left the booking is still taken but marked overbooked, and a booking already checked in is never changed', async () => {
    // rooms[0] has a guest until day 2 and rooms[1] is back in service: two rooms; book two plus one more for the same nights
    await asU(w.A.manager, `select public.padh_room_hk_set($1::uuid,'clean',null) as r`, [rooms[1]]);
    const a1 = await apply({ ext_id: 'BK-5#0', check_in: await day(40), check_out: await day(41) });
    const a2 = await apply({ ext_id: 'BK-6#0', check_in: await day(40), check_out: await day(41) });
    const a3 = await apply({ ext_id: 'BK-7#0', check_in: await day(40), check_out: await day(41) });
    expect([a1.overbooked, a2.overbooked, a3.overbooked]).toEqual([false, false, true]);
    expect((await db.admin<{ notes: string }>(`select notes from public.reservations where id = $1`, [a3.id]))[0]!.notes).toMatch(/^OVERBOOKED/);
    await db.admin(`update public.reservations set status = 'checked_in' where id = $1`, [a1.id]);
    expect((await apply({ ext_id: 'BK-5#0', status: 'modified', check_in: await day(40), check_out: await day(43) })).action).toBe('kept');
    expect((await apply({ ext_id: 'BK-5#0', status: 'cancelled' })).action).toBe('kept');
  });
  it('the webhook address finds the hotel by its secret only when the channel is on', async () => {
    const secret = (await asU(w.A.owner, `select public.padh_channel_get() as r`)).link.webhook_secret;
    expect(await svc(`select public.padh_channel_by_secret($1) as r`, [secret])).toMatchObject({ restaurant_id: w.A.rid, property_id: PROP });
    expect(await svc(`select public.padh_channel_by_secret('nope') as r`)).toBeNull();
    expect((await svc(`select public.padh_channel_pull_due(0) as r`)).map((x: any) => x.restaurant_id)).toContain(w.A.rid);
    await svc(`select public.padh_channel_pulled($1::uuid,null) as r`, [w.A.rid]);
    expect((await svc(`select public.padh_channel_pull_due(10) as r`)).map((x: any) => x.restaurant_id)).not.toContain(w.A.rid);
    await asU(w.A.owner, `select public.padh_channel_save($1,false) as r`, [PROP]);
    expect(await svc(`select public.padh_channel_by_secret($1) as r`, [secret])).toBeNull();
  });
});
