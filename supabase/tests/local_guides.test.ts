import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Local guides (migration 0070): the hotel lists people guests can contact; guests see only their own hotel's active ones.
let db: TestDb;
let w: World;
let sessionA: string;
let sessionB: string;
const save = (uid: string, o: Partial<Record<string, unknown>> = {}) => db.as('authenticated', uid,
  `select public.padh_lguide_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
  [o.id ?? null, o.name ?? 'Ravi Sharma', 'title' in o ? o.title : 'Heritage walk guide', o.about ?? null, 'languages' in o ? o.languages : 'English, Hindi', 'charges' in o ? o.charges : '₹1,500 for 3 hours', 'phone' in o ? o.phone : '98290 11223', o.whatsapp ?? null, o.instagram ?? null, o.linkedin ?? null, o.active ?? true, o.sort ?? 100] as never);
const saveErr = (uid: string, o: Partial<Record<string, unknown>> = {}) => db.asErr('authenticated', uid,
  `select public.padh_lguide_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [o.id ?? null, 'name' in o ? o.name : 'Ravi Sharma', null, null, null, null, 'phone' in o ? o.phone : '9829011223', o.whatsapp ?? null, o.instagram ?? null, o.linkedin ?? null, 'active' in o ? o.active : true, 'sort' in o ? o.sort : 100] as never);
const guestList = async (s: string) => (await db.as('service_role', null, `select public.padh_guest_lguides($1) as r`, [s] as never))[0]!.r as { guides: any[] };
async function session(rid: string, no: string) {
  const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) returning id`, [rid, no]))[0]!.id;
  return (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status) values ($1,$2,'Guest','+91','\\x01','\\x02',$3,'active') returning id`, [rid, room, Buffer.from(randomUUID() + randomUUID()).subarray(0, 32)]))[0]!.id;
}
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const t of [w.A, w.B]) await db.admin(`insert into public.hotel_settings (restaurant_id, is_mock, enabled) values ($1, true, true)`, [t.rid]);
  sessionA = await session(w.A.rid, '101');
  sessionB = await session(w.B.rid, '101');
});
afterAll(async () => db.close());

describe('the hotel lists its guides', () => {
  it('only the owner or manager can add or change; reception, kitchen and strangers cannot', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await saveErr(uid))?.code).toBe('GM011');
    expect((await db.asErr('authenticated', w.A.waiter, `select public.padh_lguide_manage()`, [] as never))?.code).toBe('GM011');
  });
  it('a name and one way to reach them is all that is needed; phone numbers are tidied; an Instagram link becomes a handle', async () => {
    const a = (await save(w.A.manager, { name: '  Ravi Sharma ', phone: '+91 98290-11223' }))[0]!.r as { id: string };
    const b = (await save(w.A.owner, { name: 'Meera Photography', title: null, charges: null, languages: null, phone: null, instagram: 'https://www.instagram.com/meera.clicks/' }))[0]!.r as { id: string };
    const c = (await save(w.A.owner, { name: 'Imran, driver-guide', phone: null, whatsapp: '9829055555', linkedin: 'https://www.linkedin.com/in/imran-khan' }))[0]!.r as { id: string };
    const list = ((await db.as('authenticated', w.A.owner, `select public.padh_lguide_manage() as r`, [] as never))[0]!.r as { guides: any[] }).guides;
    expect(list).toHaveLength(3);
    expect(list.find((g) => g.id === a.id)).toMatchObject({ name: 'Ravi Sharma', phone: '919829011223', active: true });
    expect(list.find((g) => g.id === b.id)).toMatchObject({ instagram: 'meera.clicks', phone: null });
    expect(list.find((g) => g.id === c.id)).toMatchObject({ whatsapp: '9829055555', linkedin: 'https://www.linkedin.com/in/imran-khan' });
  });
  it('refuses a guide nobody can reach, a bad link, a bad number, a long name, and updating another hotel\'s guide', async () => {
    expect((await saveErr(w.A.owner, { phone: null }))?.code).toBe('GM015');
    expect((await saveErr(w.A.owner, { phone: '12345' }))?.code).toBe('GM015');
    expect((await saveErr(w.A.owner, { phone: null, linkedin: 'http://insecure.example.com/x' }))?.code).toBe('GM015');
    expect((await saveErr(w.A.owner, { phone: null, linkedin: 'javascript:alert(1)' }))?.code).toBe('GM015');
    expect((await saveErr(w.A.owner, { name: 'x'.repeat(81) }))?.code).toBe('GM015');
    expect((await saveErr(w.A.owner, { name: '   ' }))?.code).toBe('GM015');
    expect((await saveErr(w.A.owner, { sort: -1 }))?.code).toBe('GM015');
    const mine = ((await db.as('authenticated', w.A.owner, `select public.padh_lguide_manage() as r`, [] as never))[0]!.r as { guides: any[] }).guides[0].id;
    expect((await saveErr(w.B.owner, { id: mine }))?.code).toBe('GM012');
  });
});

describe('what a guest sees', () => {
  it('the active guides of their own hotel only, in the hotel\'s order; a switched-off guide is hidden; another hotel never shows', async () => {
    expect((await guestList(sessionA)).guides.map((g) => g.name)).toEqual(['Imran, driver-guide', 'Meera Photography', 'Ravi Sharma']);
    const off = (await guestList(sessionA)).guides.find((g) => g.name === 'Meera Photography').id;
    await save(w.A.owner, { id: off, name: 'Meera Photography', phone: null, instagram: 'meera.clicks', active: false });
    expect((await guestList(sessionA)).guides.map((g) => g.name)).toEqual(['Imran, driver-guide', 'Ravi Sharma']);
    expect((await guestList(sessionB)).guides).toEqual([]);
    await save(w.A.owner, { id: off, name: 'Meera Photography', phone: null, instagram: 'meera.clicks', active: true, sort: 1 });
    expect((await guestList(sessionA)).guides[0]!.name).toBe('Meera Photography'); // sorted first now
  });
  it('a closed session gets nothing; signed-in staff cannot call the guest function', async () => {
    await db.admin(`update public.guest_sessions set status = 'ended' where id = $1`, [sessionB]);
    expect((await db.asErr('service_role', null, `select public.padh_guest_lguides($1)`, [sessionB] as never))?.code).toBe('GM009');
    expect((await db.asErr('authenticated', w.A.owner, `select public.padh_guest_lguides($1)`, [sessionA] as never))?.code).toBe('42501');
  });
  it('a hotel can list forty guides, not more', async () => {
    for (let i = 0; i < 37; i++) await save(w.A.owner, { name: `Guide ${i}` });
    expect((await saveErr(w.A.owner, { name: 'One too many' }))?.code).toBe('GM006');
  });
});
