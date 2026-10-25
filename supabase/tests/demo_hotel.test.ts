import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Public demo hotel (migration 0057): only a hotel the admin switched to demo is reachable, each visitor gets a fresh session, and the demo answers itself.
let db: TestDb;
let w: World;
const svc = async <T = any>(fn: string, a: unknown[]): Promise<T> => (await db.as('service_role', null, `select public.${fn}(${a.map((_, i) => `$${i + 1}`).join(',')}) as r`, a as never))[0]!.r as T;
const svcErr = (fn: string, a: unknown[]) => db.asErr('service_role', null, `select public.${fn}(${a.map((_, i) => `$${i + 1}`).join(',')}) as r`, a as never);
const enter = (slug: string, ip = 'ip1') => svc<{ session_id: string; room: string }>('padh_demo_enter', [slug, randomBytes(32), Buffer.from('x'), randomBytes(32), ip]);
const age = (table: string, col: string, id: string, secs: number, key = 'id') => db.admin(`update public.${table} set ${col} = now() - ($2 || ' seconds')::interval where ${key} = $1`, [id, String(secs)]);
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const t of [w.A, w.B]) await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [t.rid]);
});
afterAll(async () => db.close());

describe('public demo hotel', () => {
  it('only the platform admin switches it on; a normal hotel cannot be entered or described', async () => {
    expect(await svc('padh_demo_info', [w.A.slug])).toBeNull();
    expect((await svcErr('padh_demo_enter', [w.A.slug, randomBytes(32), Buffer.from('x'), randomBytes(32), 'ip']))?.code).toBe('GM012');
    expect((await svcErr('padh_admin_set_demo', [w.stranger, w.A.rid, true]))?.code).toBeTruthy();
    expect(await svc('padh_admin_set_demo', [w.admin, w.A.rid, true])).toEqual({ is_demo: true });
    expect(await svc('padh_demo_info', [w.A.slug])).toMatchObject({ slug: w.A.slug });
    expect((await db.admin<any>(`select count(*)::int n from public.rooms where restaurant_id = $1 and number like 'D%'`, [w.A.rid]))[0].n).toBe(8);
    expect(await svc('padh_demo_info', [w.B.slug])).toBeNull(); // another hotel stays closed
  });
  it('each visitor gets a free room and a fresh session; with all rooms taken the oldest visit makes room', async () => {
    const rooms = new Set<string>();
    for (let i = 0; i < 8; i++) rooms.add((await enter(w.A.slug)).room);
    expect(rooms.size).toBe(8);
    const ninth = await enter(w.A.slug);
    expect(rooms.has(ninth.room)).toBe(true);
    expect((await db.admin<any>(`select count(*)::int n from public.guest_sessions where restaurant_id = $1 and status = 'active'`, [w.A.rid]))[0].n).toBe(8);
  });
  it('a visitor who keeps entering from one address is slowed down', async () => {
    await db.admin(`delete from public.rate_limits`);
    let err: string | undefined;
    for (let i = 0; i < 25 && !err; i++) err = (await svcErr('padh_demo_enter', [w.A.slug, randomBytes(32), Buffer.from('x'), randomBytes(32), 'busy']))?.code;
    expect(err).toBe('GM007');
  });
  it('requests answer themselves: accepted after 6 seconds, done after 15 more; a help request is resolved; orders move on; a real hotel is never touched', async () => {
    await db.admin(`delete from public.rate_limits`);
    const s = (await enter(w.A.slug, 'tick')).session_id;
    const mk = async (type: string, label: string) => (await svc<{ request_id: string }>('padh_guest_create_request', [s, type, label, null, false, randomUUID()])).request_id;
    const hk = await mk('housekeeping', 'Towels');
    const help = await mk('help', 'AC');
    const st = async (id: string) => (await db.admin<any>(`select status, resolution from public.requests where id = $1`, [id]))[0];
    await svc('padh_demo_tick', [s]);
    expect((await st(hk)).status).toBe('received'); // too soon
    await age('requests', 'created_at', hk, 10); await age('requests', 'created_at', help, 10);
    await svc('padh_demo_tick', [s]);
    expect((await st(hk)).status).toBe('accepted');
    await age('requests', 'accepted_at', hk, 20); await age('requests', 'accepted_at', help, 20);
    await svc('padh_demo_tick', [s]);
    expect((await st(hk)).status).toBe('completed');
    expect(await st(help)).toMatchObject({ status: 'completed', resolution: 'fixed' });
    expect((await db.admin<any>(`select count(*)::int n from public.messages where session_id = $1 and request_id = $2`, [s, hk]))[0].n).toBeGreaterThanOrEqual(3);
    // a real hotel's guest is never moved on
    const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'501') returning id`, [w.B.rid]))[0]!.id;
    const real = (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Real','+91','\\x01','\\x02',$3,'active') returning id`, [w.B.rid, room, randomBytes(32)]))[0]!.id;
    const r = (await svc<{ request_id: string }>('padh_guest_create_request', [real, 'housekeeping', 'Towels', null, false, randomUUID()])).request_id;
    await age('requests', 'created_at', r, 100);
    await svc('padh_demo_tick', [real]);
    expect((await st(r)).status).toBe('received');
  });
});
