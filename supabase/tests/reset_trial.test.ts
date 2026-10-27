import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Wiping a trial hotel's test data (migration 0077): owner only, typed word, own hotel only, setup kept.
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
const n = async (table: string, rid: string) => (await db.admin<{ n: number }>(`select count(*)::int as n from public.${table} where restaurant_id = $1`, [rid]))[0]!.n;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, true), ($2, true, true)`, [w.A.rid, w.B.rid]);
  for (const [rid, no] of [[w.A.rid, '801'], [w.B.rid, '801']] as const) await db.admin(`insert into public.rooms (restaurant_id, number) values ($1,$2)`, [rid, no]);
  const room = (await db.admin<{ id: string }>(`select id from public.rooms where restaurant_id = $1`, [w.A.rid]))[0]!.id;
  await asU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Trial Guest',null,null,null,1,null,null,null,null,300000,(now() at time zone 'Asia/Kolkata')::date + 1,0,null) as r`, [room]);
  await asU(w.A.waiter, `select public.padh_reservation_save(null,null,null,'Trial Booking',null,1,(now() at time zone 'Asia/Kolkata')::date + 2,(now() at time zone 'Asia/Kolkata')::date + 3,100000,0,null,null,null) as r`).catch(() => null);
  await asU(w.A.waiter, `select public.padh_pos_bill('[{"name":"Tea","qty":1,"unit_paise":2000}]',null,null,'cash',null,0,0,0) as r`);
  await db.admin(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Guest One','+91','\\x01',decode(md5(random()::text)||md5(random()::text),'hex'),decode(md5(random()::text)||md5(random()::text),'hex'),'active')`, [w.A.rid, room]);
});
afterAll(async () => db.close());

describe('reset trial data', () => {
  it('only the owner can do it, only with the word RESET, and only with a known scope', async () => {
    for (const uid of [w.A.manager, w.A.waiter, w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_reset_trial('activity','RESET')`))?.code).toBe('GM011');
    for (const [s, c] of [['activity', 'reset'], ['activity', ''], ['all', 'RESET'], [null, 'RESET']]) expect((await errU(w.A.owner, `select public.padh_reset_trial($1,$2)`, [s, c]))?.code).toBe('GM015');
  });
  it('"activity" clears what the guests did and keeps check-ins, bills and the setup', async () => {
    expect(await n('guest_sessions', w.A.rid)).toBeGreaterThan(0);
    const r = await asU(w.A.owner, `select public.padh_reset_trial('activity','RESET') as r`);
    expect(r.guest_logins).toBeGreaterThan(0);
    expect(await n('guest_sessions', w.A.rid)).toBe(0);
    expect(await n('stays', w.A.rid)).toBe(1);
    expect(await n('pos_bills', w.A.rid)).toBe(1);
    expect(await n('rooms', w.A.rid)).toBeGreaterThan(0);
  });
  it('"everything" also clears check-ins, bookings, counter bills and starts the numbering again; the other hotel is untouched; the setup stays', async () => {
    await db.admin(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) select $1, id, 'Guest Two', '+91', '\\x01', decode(md5(random()::text)||md5(random()::text),'hex'), decode(md5(random()::text)||md5(random()::text),'hex'), 'active' from public.rooms where restaurant_id = $1`, [w.B.rid]);
    const before = await n('guest_sessions', w.B.rid);
    const r = await asU(w.A.owner, `select public.padh_reset_trial('everything','RESET') as r`);
    expect(r).toMatchObject({ stays: 1, counter_bills: 1 });
    for (const t of ['stays', 'reservations', 'pos_bills', 'invoice_counters', 'pos_counters']) expect(await n(t, w.A.rid)).toBe(0);
    expect(await n('rooms', w.A.rid)).toBeGreaterThan(0);
    expect(await n('guest_sessions', w.B.rid)).toBe(before);
    // the next counter bill is number 1 again
    const b = await asU(w.A.waiter, `select public.padh_pos_bill('[{"name":"Tea","qty":1,"unit_paise":2000}]',null,null,'cash',null,0,0,0) as r`);
    expect(b.number).toMatch(/\/0001$/);
  });
});
