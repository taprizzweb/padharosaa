import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// The thank-you after check-out (migration 0058): only a session that reception ended at check-out, only for 14 days, nothing private.
let db: TestDb;
let w: World;
const farewell = async (token: Buffer) => (await db.as('service_role', null, `select public.padh_guest_farewell($1) as r`, [token] as never))[0]!.r as any;
async function guest(room: string, name: string) {
  const token = randomBytes(32);
  const rm = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) on conflict (restaurant_id, number) do update set number = excluded.number returning id`, [w.A.rid, room]))[0]!.id;
  await db.admin(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,$3,'+91','\\x01',$4,$5,'active')`, [w.A.rid, rm, name, randomBytes(16), createHash('sha256').update(token).digest()]);
  return { token: createHash('sha256').update(token).digest(), room: rm };
}
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, review_link, brand_color) values ($1, true, 'https://g.page/r/h/review', '#a8493c')`, [w.A.rid]);
});
afterAll(async () => db.close());

describe('check-out thank-you', () => {
  it('a guest who is still staying gets nothing; after reception checks the room out the guest gets the hotel\'s thank-you and review link', async () => {
    const g = await guest('401', 'Anita Sharma');
    expect(await farewell(g.token)).toEqual({ ok: false });
    await db.as('authenticated', w.A.waiter, `select public.padh_checkout_room($1)`, [g.room] as never);
    expect(await farewell(g.token)).toMatchObject({ ok: true, name: 'Anita', hotel_name: expect.any(String), google_review_url: 'https://g.page/r/h/review', brand_color: '#a8493c' });
  });
  it('a session that ended for another reason, an unknown cookie and a visit older than 14 days get nothing', async () => {
    const other = await guest('402', 'Ravi');
    await db.admin(`update public.guest_sessions set status = 'ended', ended_at = now() where token_hash = $1`, [other.token]);
    expect(await farewell(other.token)).toEqual({ ok: false });
    expect(await farewell(randomBytes(32))).toEqual({ ok: false });
    const old = await guest('403', 'Old Guest');
    await db.as('authenticated', w.A.owner, `select public.padh_checkout_room($1)`, [old.room] as never);
    await db.admin(`update public.guest_sessions set ended_at = now() - interval '15 days' where token_hash = $1`, [old.token]);
    expect(await farewell(old.token)).toEqual({ ok: false });
  });
  it('the thank-you carries no room, phone or request detail', async () => {
    const g = await guest('404', 'Meera K');
    await db.as('authenticated', w.A.manager, `select public.padh_checkout_room($1)`, [g.room] as never);
    expect(Object.keys(await farewell(g.token)).sort()).toEqual(['brand_color', 'google_review_url', 'hotel_name', 'language', 'name', 'ok', 'slug', 'tripadvisor_url']);
  });
});
