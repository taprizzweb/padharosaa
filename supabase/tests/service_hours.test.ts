import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Opening and closing time for guest requests (migration 0048): outside the hours nothing reaches the desk.
let db: TestDb;
let w: World;
let session: string;
let roomTable: string;
let plainTable: string;
const idem = () => randomUUID();
const call = (fn: string, n: number) => `select public.${fn}(${Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',')}) as r`;
const svc = async <T = any>(fn: string, a: unknown[]): Promise<T> => (await db.as('service_role', null, call(fn, a.length), a as never))[0]!.r as T;
const svcErr = (fn: string, a: unknown[]) => db.asErr('service_role', null, call(fn, a.length), a as never);
const staff = async <T = any>(uid: string, fn: string, a: unknown[]): Promise<T> => (await db.as('authenticated', uid, call(fn, a.length), a as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, a: unknown[]) => db.asErr('authenticated', uid, call(fn, a.length), a as never);
const label = () => `Towels ${randomUUID().slice(0, 6)}`; // a new wording each time, so a repeat is never merged into an open request
const help = () => svc<any>('padh_guest_create_request', [session, 'help', label(), null, false, idem()]);
const helpErr = () => svcErr('padh_guest_create_request', [session, 'help', label(), null, false, idem()]);
// a time of day relative to now in the hotel's own clock (Asia/Kolkata)
const at = async (plus: string) => (await db.admin<{ t: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::time + interval '${plus}', 'HH24:MI') as t`))[0]!.t;
const setHours = (start: string | null, end: string | null) => staff(w.A.manager, 'padh_service_hours_set', [start, end]);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await svc<any>('padh_admin_enable_hotel', [w.admin, w.A.rid, 'Asia/Kolkata']);
  const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'204') returning id`, [w.A.rid]))[0]!.id;
  session = (
    await db.admin<{ id: string }>(
      `insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status)
       values ($1,$2,'Anita','+91','\\x01','\\x02',$3,'active') returning id`,
      [w.A.rid, room, Buffer.from(randomUUID())],
    )
  )[0]!.id;
  roomTable = (await db.admin<{ id: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1,'Room 204','room') returning id`, [w.A.rid]))[0]!.id;
  plainTable = (await db.admin<{ id: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,'T9') returning id`, [w.A.rid]))[0]!.id;
});
afterAll(async () => db.close());

const roomSession = async (table: string) =>
  (await db.admin<{ id: string }>(`select id from public.table_sessions where table_id = $1 and closed_at is null`, [table]))[0]?.id ??
  (await db.admin<{ id: string }>(`insert into public.table_sessions (restaurant_id, table_id) values ($1,$2) returning id`, [w.A.rid, table]))[0]!.id;
const orderRow = (table: string, sess: string) =>
  db.admin(`insert into public.orders (restaurant_id, table_id, session_id, order_no, total_paise, idempotency_key) values ($1,$2,$3, (select coalesce(max(order_no),0)+1 from public.orders where restaurant_id = $1), 100, $4)`, [w.A.rid, table, sess, randomUUID()]);
const callRow = (table: string, sess: string, type: 'waiter' | 'bill') =>
  db.admin(`insert into public.service_requests (restaurant_id, table_id, session_id, type, reason, pay_mode) values ($1,$2,$3,$4,$5,$6)`, [w.A.rid, table, sess, type, type === 'waiter' ? 'water' : null, type === 'bill' ? 'cash' : null]);
const insertErr = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e) { return (e as { code?: string }).code ?? 'other'; } };

describe('service hours', () => {
  it('with no hours set, requests are open all day (the default)', async () => {
    expect((await help()).replayed).toBeFalsy();
    expect((await svc<any>('padh_service_hours_guest', [session])).open).toBe(true);
  });

  it('only the owner or manager can set them; both times or none; different times; waiters and other hotels refused', async () => {
    expect((await staffErr(w.A.waiter, 'padh_service_hours_set', ['07:00', '23:00']))?.code).toBe('GM011');
    expect((await staffErr(w.B.owner, 'padh_service_hours_set', ['07:00', '23:00']))?.code).not.toBeNull(); // hotel B is not a Padharosaa hotel here
    expect((await staffErr(w.A.owner, 'padh_service_hours_set', ['07:00', null]))?.code).toBe('GM015');
    expect((await staffErr(w.A.owner, 'padh_service_hours_set', ['07:00', '07:00']))?.code).toBe('GM015');
    expect((await db.asErr('anon', null, `select public.padh_service_hours_set('07:00','23:00')`))?.code).toBe('42501');
    expect((await svcErr('padh_service_hours_set', ['07:00', '23:00']))?.code).toBe('42501');
    expect(await setHours('07:00', '23:00')).toEqual({ service_start: '07:00', service_end: '23:00' });
    expect((await staff<any>(w.A.owner, 'padh_manage_settings', []))).toMatchObject({ service_start: '07:00', service_end: '23:00' });
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where restaurant_id = $1 and action = 'padh_service_hours_set'`, [w.A.rid]))[0].n).toBeGreaterThan(0);
  });

  it('after closing nothing arrives: a Padharosaa request, a help call, a room food order and a room waiter call are all refused', async () => {
    await setHours(await at('+2 hours'), await at('+3 hours')); // opens in two hours
    expect((await helpErr())?.code).toBe('GM025');
    expect((await svc<any>('padh_service_hours_guest', [session])).open).toBe(false);
    const ts = await roomSession(roomTable);
    expect(await insertErr(() => orderRow(roomTable, ts))).toBe('GM025');
    expect(await insertErr(() => callRow(roomTable, ts, 'waiter'))).toBe('GM025');
    expect(await insertErr(() => db.admin(`insert into public.help_requests (restaurant_id, room, topics) values ($1,'204','{water}')`, [w.A.rid]))).toBe('GM025');
    expect((await db.admin<any>(`select count(*)::int n from public.orders where table_id = $1`, [roomTable]))[0].n).toBe(0);
  });

  it('after closing a guest can still ask for the bill, and an ordinary restaurant table is not affected', async () => {
    const ts = await roomSession(roomTable);
    expect(await insertErr(() => callRow(roomTable, ts, 'bill'))).toBeNull();
    const ps = await roomSession(plainTable);
    expect(await insertErr(() => orderRow(plainTable, ps))).toBeNull();
    expect(await insertErr(() => callRow(plainTable, ps, 'waiter'))).toBeNull();
  });

  it('inside the hours it works, including a window that runs past midnight; clearing the hours opens it all day', async () => {
    await setHours(await at('-1 hour'), await at('+1 hour'));
    expect((await help()).replayed).toBeFalsy();
    await setHours(await at('+1 hour'), await at('-1 hour')); // 'closing' earlier than 'opening' = open overnight: closed only in this one gap... now is inside the closed gap
    expect((await helpErr())?.code).toBe('GM025');
    await setHours(await at('-1 hour'), await at('-2 hours')); // now falls inside the overnight window
    expect((await help()).replayed).toBeFalsy();
    await setHours(null, null);
    expect((await svc<any>('padh_service_hours_guest', [session])).open).toBe(true);
    expect((await help()).replayed).toBeFalsy();
  });

  it('only the guest\'s own session answers; an unknown session is not found', async () => {
    expect((await svcErr('padh_service_hours_guest', [randomUUID()]))?.code).toBe('GM012');
    expect((await staffErr(w.A.owner, 'padh_service_hours_guest', [session]))?.code).toBe('42501');
  });
});
