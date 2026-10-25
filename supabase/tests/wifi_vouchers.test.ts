import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// A Wi-Fi login for every guest (migration 0062): the owner pastes a list, each room gets the next unused login, a used one is never given again.
let db: TestDb;
let w: World;
const hex = (s: string) => Buffer.from(s).toString('hex');
const add = async (uid: string, items: { username: string; password: string }[]) => (await db.as('authenticated', uid, `select public.padh_wifi_vouchers_add($1) as r`, [JSON.stringify(items.map((i) => ({ username: i.username, password_enc: hex(i.password) })))] as never))[0]!.r as any;
const status = async (uid: string) => (await db.as('authenticated', uid, `select public.padh_wifi_vouchers_status() as r`, [] as never))[0]!.r as any;
const wifi = async (session: string) => (await db.as('service_role', null, `select public.padh_guest_wifi($1) as r`, [session] as never))[0]!.r as { username: string; password_enc: string } | null;
async function guest(room: string) {
  const rm = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) on conflict (restaurant_id, number) do update set number = excluded.number returning id`, [w.A.rid, room]))[0]!.id;
  return (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Guest','+91','\\x01',$3,$4,'active') returning id`, [w.A.rid, rm, Buffer.from(randomUUID()), Buffer.from(randomUUID())]))[0]!.id;
}
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.A.rid]);
});
afterAll(async () => db.close());

describe('wifi logins', () => {
  it('only the owner or manager adds them; reception, kitchen and strangers cannot; bad input is refused', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await db.asErr('authenticated', uid, `select public.padh_wifi_vouchers_add('[{"username":"1","password_enc":"aa"}]')`, [] as never))?.code).toBe('GM011');
    for (const bad of ['[]', '{}', 'not json', '[{"username":"","password_enc":"aa"}]', '[{"username":"1","password_enc":"zz"}]']) expect((await db.asErr('authenticated', w.A.owner, `select public.padh_wifi_vouchers_add($1)`, [bad] as never))?.code).toBe('GM015');
    expect(await add(w.A.manager, [{ username: '70001', password: 'AAAA' }])).toEqual({ added: 1, skipped: 0 });
    expect(await add(w.A.owner, [{ username: '70001', password: 'DUPL' }, { username: '70002', password: 'BBBB' }, { username: '70003', password: 'CCCC' }])).toEqual({ added: 2, skipped: 1 });
    expect(await status(w.A.owner)).toEqual({ free: 3, given: 0 });
    expect((await db.asErr('authenticated', w.A.waiter, `select public.padh_wifi_vouchers_status()`, [] as never))?.code).toBe('GM011');
  });
  it('each room gets the next unused login once; a second guest of the same room shares it; the next guest of that room gets a new one', async () => {
    const a = await guest('701'); const a2 = await guest('701'); const b = await guest('702');
    const va = await wifi(a);
    expect(va?.username).toBe('70001');
    expect(Buffer.from(va!.password_enc, 'hex').toString()).toBe('AAAA');
    expect(await wifi(a)).toEqual(va); // looking again gives the same login
    expect(await wifi(a2)).toEqual(va); // same room
    expect((await wifi(b))?.username).toBe('70002');
    expect(await status(w.A.owner)).toEqual({ free: 1, given: 2 });
    // room 701 checks out, a new guest arrives: a fresh login, never the old one again
    await db.admin(`update public.guest_sessions set status = 'ended' where id = any($1::uuid[])`, [[a, a2]]);
    const a3 = await guest('701');
    expect((await wifi(a3))?.username).toBe('70003');
  });
  it('when the list runs out, or the hotel has no list, the answer is null (the shared Wi-Fi is shown instead)', async () => {
    expect(await wifi(await guest('703'))).toBeNull();
    expect(await wifi(await guest('704'))).toBeNull();
  });
  it('one hotel\'s logins are never given to another hotel\'s guest', async () => {
    await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.B.rid]);
    const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'1') returning id`, [w.B.rid]))[0]!.id;
    const s = (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Guest B','+91','\\x01',$3,$4,'active') returning id`, [w.B.rid, room, Buffer.from(randomUUID()), Buffer.from(randomUUID())]))[0]!.id;
    expect(await wifi(s)).toBeNull();
  });
});
