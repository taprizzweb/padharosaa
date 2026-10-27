import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Guest verification (migration 0064): strict hotels need the room's stay code, light ones do not; only owner/manager change it.
const sha = (v: string) => createHash('sha256').update(v).digest();
let db: TestDb;
let w: World;
const level = async (uid: string, l: unknown) => db.as('authenticated', uid, `select public.padh_set_verification($1) as r`, [l] as never);
const login = async (room: string, code: string | null) => (await db.as('service_role', null,
  `select public.padh_guest_login($1,$2,'Asha','+91',$3,$4,'en',$5,$6,$7,null,true,'v1','ip1') as r`,
  [w.A.slug, KEY, Buffer.from('enc'), sha(`m-${room}-${code}`), room, code, sha(`t-${room}-${code}-${Math.random()}`)] as never))[0]!.r as { ok: boolean; code?: string };
const KEY = 'a'.repeat(64);
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, qr_key_hash) values ($1, true, $2)`, [w.A.rid, createHash('sha256').update(KEY).digest()]);
  await db.admin(`insert into public.rooms (restaurant_id, number) values ($1,'101')`, [w.A.rid]);
});
afterAll(async () => db.close());

describe('guest verification', () => {
  it('only the owner or manager change it, and only to light or strict', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await db.asErr('authenticated', uid, `select public.padh_set_verification('strict')`, [] as never))?.code).toBe('GM011');
    for (const bad of ['off', 'verified', '', 'STRICT']) expect((await db.asErr('authenticated', w.A.owner, `select public.padh_set_verification($1)`, [bad] as never))?.code).toBe('GM015');
    expect((await level(w.A.manager, 'strict'))[0]!.r).toEqual({ verification_level: 'strict' });
    const s = (await db.as('authenticated', w.A.owner, `select public.padh_manage_settings() as r`, [] as never))[0]!.r as any;
    expect(s.verification_level).toBe('strict');
  });
  it('strict: no code or a wrong code is refused, the issued code opens the room; light: no code needed', async () => {
    const rm = (await db.admin<{ id: string }>(`select id from public.rooms where restaurant_id = $1 and number = '101'`, [w.A.rid]))[0]!.id;
    expect((await login('101', null)).ok).toBe(false);
    const code = ((await db.as('authenticated', w.A.waiter, `select public.padh_issue_stay_code($1) as r`, [rm] as never))[0]!.r as { code: string }).code;
    expect(code).toMatch(/^[0-9]{4}$/);
    expect((await login('101', code === '0000' ? '1111' : '0000')).ok).toBe(false);
    expect((await login('101', code)).ok).toBe(true);
    await level(w.A.owner, 'light');
    expect((await login('101', null)).ok).toBe(true);
  });
});
