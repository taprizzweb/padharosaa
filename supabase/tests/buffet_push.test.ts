import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Buffet phone notifications (migration 0054): who may set the time, who gets the message, once a day.
let db: TestDb;
let w: World;
let sessions: string[] = [];
const sub = (n: number) => ({ endpoint: `https://push.example.com/send/${n}${'x'.repeat(20)}`, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } });
const call = (fn: string, n: number) => `select public.${fn}(${Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',')}) as r`;
const svc = async <T = any>(fn: string, a: unknown[]): Promise<T> => (await db.as('service_role', null, call(fn, a.length), a as never))[0]!.r as T;
const svcErr = (fn: string, a: unknown[]) => db.asErr('service_role', null, call(fn, a.length), a as never);
const staff = async <T = any>(uid: string, fn: string, a: unknown[]): Promise<T> => (await db.as('authenticated', uid, call(fn, a.length), a as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, a: unknown[]) => db.asErr('authenticated', uid, call(fn, a.length), a as never);
const at = async (plus: string) => (await db.admin<{ t: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::time + interval '${plus}', 'HH24:MI') as t`))[0]!.t;
const today = async () => (await db.admin<{ d: string }>(`select (now() at time zone 'Asia/Kolkata')::date::text as d`))[0]!.d;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await svc('padh_admin_enable_hotel', [w.admin, w.A.rid, 'Asia/Kolkata']);
  for (const n of ['101', '102', '103']) {
    const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) returning id`, [w.A.rid, n]))[0]!.id;
    sessions.push((await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Guest','+91','\\x01','\\x02',$3,'active') returning id`, [w.A.rid, room, Buffer.from(randomUUID())]))[0]!.id);
  }
});
afterAll(async () => db.close());

describe('guest phones', () => {
  it('a guest stores or clears their own phone; a bad subscription is refused; a closed session is not found', async () => {
    await svc('padh_guest_set_push', [sessions[0], sub(1)]);
    await svc('padh_guest_set_push', [sessions[1], sub(2)]);
    for (const bad of [{ endpoint: 'http://x.example.com/aaaaaaaaaa', keys: sub(1).keys }, { endpoint: sub(1).endpoint, keys: { p256dh: 'short', auth: 'a'.repeat(22) } }, { keys: sub(1).keys }, ['x']]) expect((await svcErr('padh_guest_set_push', [sessions[2], JSON.stringify(bad)]))?.code).toBe('GM015');
    expect((await svcErr('padh_guest_set_push', [randomUUID(), sub(3)]))?.code).toBe('GM012');
    expect((await staffErr(w.A.owner, 'padh_guest_set_push', [sessions[0], sub(1)]))?.code).toBe('42501');
    const t = await svc<any[]>('padh_push_targets', [w.A.rid]);
    expect(t.map((x) => x.id).sort()).toEqual([sessions[0], sessions[1]].sort());
    await svc('padh_push_drop', [sessions[1]]);
    expect((await svc<any[]>('padh_push_targets', [w.A.rid])).map((x) => x.id)).toEqual([sessions[0]]);
  });
  it('a guest who has checked out gets nothing more', async () => {
    await db.admin(`update public.guest_sessions set status = 'ended' where id = $1`, [sessions[0]]);
    expect(await svc<any[]>('padh_push_targets', [w.A.rid])).toEqual([]);
    await db.admin(`update public.guest_sessions set status = 'active' where id = $1`, [sessions[0]]);
  });
});

describe('the hotel\'s choice and the daily reminder', () => {
  it('desk, manager and owner set it; kitchen and strangers cannot; the buffet list shows it', async () => {
    for (const uid of [w.A.waiter, w.A.manager, w.A.owner]) expect(await staff(uid, 'padh_buffet_notify_set', ['18:30', true])).toEqual({ notify_time: '18:30', notify_on_save: true });
    expect((await staffErr(w.A.kitchen, 'padh_buffet_notify_set', ['18:30', true]))?.code).toBe('GM011');
    expect((await staffErr(w.stranger, 'padh_buffet_notify_set', ['18:30', true]))?.code).toBe('GM011');
    expect((await staffErr(w.A.owner, 'padh_buffet_notify_set', ['18:30', null]))?.code).toBe('GM015');
    expect(await staff(w.A.manager, 'padh_buffet_list', [])).toMatchObject({ notify_time: '18:30', notify_on_save: true });
    expect(await staff(w.A.manager, 'padh_buffet_notify_set', [null, false])).toEqual({ notify_time: null, notify_on_save: false });
    expect(await staff(w.A.manager, 'padh_buffet_list', [])).toMatchObject({ notify_time: null, notify_on_save: false });
  });

  it('the reminder is claimed once a day, only inside its half hour, only when today\'s buffet is set, and never for another hotel\'s time', async () => {
    await staff(w.A.manager, 'padh_buffet_notify_set', [await at('-5 minutes'), true]);
    expect(await svc<any[]>('padh_buffet_reminders_claim', [])).toEqual([]); // no buffet today yet
    await staff(w.A.manager, 'padh_buffet_set', [await today(), 'in_house', 'Thali night', '19:30', '22:30', 'Courtyard', null, null]);
    const first = await svc<any[]>('padh_buffet_reminders_claim', []);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ restaurant_id: w.A.rid, name: 'Thali night', start: '19:30', end: '22:30', venue: 'Courtyard', slug: w.A.slug });
    expect(await svc<any[]>('padh_buffet_reminders_claim', [])).toEqual([]); // already sent today
    expect((await db.admin<any>(`select count(*)::int n from public.notifications where template = 'buffet_reminder'`))[0].n).toBe(1);
    // not yet time, or already past the half hour: nothing
    await db.admin(`delete from public.notifications where template = 'buffet_reminder'`);
    await staff(w.A.manager, 'padh_buffet_notify_set', [await at('+2 hours'), true]);
    expect(await svc<any[]>('padh_buffet_reminders_claim', [])).toEqual([]);
    await staff(w.A.manager, 'padh_buffet_notify_set', [await at('-2 hours'), true]);
    expect(await svc<any[]>('padh_buffet_reminders_claim', [])).toEqual([]);
    // "No buffet today" is not announced
    await staff(w.A.manager, 'padh_buffet_notify_set', [await at('-1 minute'), true]);
    await staff(w.A.manager, 'padh_buffet_set', [await today(), 'none', null, null, null, null, null, null]);
    expect(await svc<any[]>('padh_buffet_reminders_claim', [])).toEqual([]);
  });

  it('closed to everyone but the server', async () => {
    for (const fn of ['padh_buffet_reminders_claim']) {
      expect((await staffErr(w.A.owner, fn, []))?.code).toBe('42501');
      expect((await db.asErr('anon', null, `select public.${fn}()`))?.code).toBe('42501');
    }
    expect((await staffErr(w.A.owner, 'padh_buffet_today', [w.A.rid]))?.code).toBe('42501');
  });
});

describe('announce right after a save', () => {
  it('only today\'s buffet, only when switched on, and not twice within ten minutes', async () => {
    await db.admin(`delete from public.notifications where template = 'buffet_saved'`);
    await staff(w.A.manager, 'padh_buffet_notify_set', [null, false]);
    await staff(w.A.manager, 'padh_buffet_set', [await today(), 'in_house', 'Thali night', '19:30', '22:30', null, null, null]);
    expect(await staff(w.A.manager, 'padh_buffet_announce', [await today()])).toBeNull(); // switched off
    await staff(w.A.manager, 'padh_buffet_notify_set', [null, true]);
    const tomorrow = (await db.admin<{ d: string }>(`select ((now() at time zone 'Asia/Kolkata')::date + 1)::text as d`))[0]!.d;
    expect(await staff(w.A.manager, 'padh_buffet_announce', [tomorrow])).toBeNull(); // not today
    expect(await staff(w.A.waiter, 'padh_buffet_announce', [await today()])).toMatchObject({ restaurant_id: w.A.rid, name: 'Thali night', start: '19:30' });
    expect(await staff(w.A.manager, 'padh_buffet_announce', [await today()])).toBeNull(); // just announced
    expect((await staffErr(w.A.kitchen, 'padh_buffet_announce', [await today()]))?.code).toBe('GM011');
    expect((await staffErr(w.stranger, 'padh_buffet_announce', [await today()]))?.code).toBe('GM011');
  });
});
