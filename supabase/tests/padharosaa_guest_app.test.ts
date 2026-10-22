import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
let sA: string, sA2: string, sB: string, roomA: string;
const svc = async <T = any>(fn: string, args: unknown[]): Promise<T> =>
  (await db.as('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const svcErr = (fn: string, args: unknown[]) => db.asErr('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const staff = async <T = any>(uid: string, fn: string, args: unknown[]): Promise<T> =>
  (await db.as('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, args: unknown[]) => db.asErr('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const mk = async (rid: string, room: string, name: string) => {
  const r = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) on conflict (restaurant_id, number) do update set number = excluded.number returning id`, [rid, room]))[0]!.id;
  return { room: r, id: (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, diet) values ($1,$2,$3,'+91','\\xdeadbeef','\\x02',$4,'jain') returning id`, [rid, r, name, Buffer.from(randomUUID())]))[0]!.id };
};
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const t of [w.A, w.B]) await svc('padh_admin_enable_hotel', [w.admin, t.rid, 'Asia/Kolkata']);
  const a = await mk(w.A.rid, '204', 'Anita'); sA = a.id; roomA = a.room;
  sA2 = (await mk(w.A.rid, '205', 'Ravi')).id;
  sB = (await mk(w.B.rid, '204', 'Pierre')).id;
});
afterAll(async () => db.close());

describe('home boxes and stay info', () => {
  it('manager sets offer + info; the guest sees the offer only until it ends; waiter and kitchen cannot', async () => {
    const until = new Date(Date.now() + 3 * 3600_000).toISOString();
    await staff(w.A.manager, 'padh_set_home', ['  Free lassi ‮tonight ', until, 'Pool closed 1 to 3 PM']);
    const h = await svc<any>('padh_guest_home', [sA]);
    expect(h).toMatchObject({ offer: 'Free lassi tonight', info: 'Pool closed 1 to 3 PM', open_requests: 0, buffet: { set: false } });
    await db.admin(`update public.hotel_settings set offer_until = now() - interval '1 minute' where restaurant_id = $1`, [w.A.rid]);
    expect((await svc<any>('padh_guest_home', [sA])).offer).toBeNull();
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await staffErr(uid, 'padh_set_home', [null, null, 'x']))?.code, uid).toBe('GM011');
    expect((await staffErr(w.A.manager, 'padh_set_home', ['Offer', null, null]))?.code).toBe('GM015'); // an offer needs an end time
    expect((await staffErr(w.A.manager, 'padh_set_home', ['Offer', new Date(Date.now() + 9 * 86400_000).toISOString(), null]))?.code).toBe('GM015'); // max 7 days
    expect((await staffErr(w.A.manager, 'padh_set_home', [null, null, 'x'.repeat(401)]))?.code).toBe('GM015');
    await staff(w.A.manager, 'padh_set_home', [null, null, null]);
    expect(await svc<any>('padh_guest_home', [sA])).toMatchObject({ offer: null, info: null });
  });

  it('home reports today\'s buffet, open request count and the links; other hotels stay separate', async () => {
    await db.admin(`insert into public.buffets (restaurant_id, service_date, mode, name, start_time, end_time, venue) values ($1, (now() at time zone 'Asia/Kolkata')::date, 'in_house','Thali night','19:30','22:30','Courtyard')`, [w.A.rid]);
    await staff(w.A.manager, 'padh_set_branding', ['#0d9488', null, null, null, null, '@haveli', null, null, 'https://menu.taprizz.in/haveli']);
    await svc('padh_guest_create_request', [sA, 'cab', 'Cab', null, false, 'idem-key-1']);
    const h = await svc<any>('padh_guest_home', [sA]);
    expect(h.buffet).toEqual({ set: true, mode: 'in_house', name: 'Thali night', start: '19:30', end: '22:30', venue: 'Courtyard' });
    expect(h.open_requests).toBe(1);
    expect(h.look).toMatchObject({ name: 'Cafe Aroma', brand_color: '#0d9488', is_mock: false });
    expect(h.links).toMatchObject({ instagram_url: 'https://www.instagram.com/haveli', menu_url: 'https://menu.taprizz.in/haveli' });
    expect((await svc<any>('padh_guest_home', [sB])).buffet).toEqual({ set: false });
    expect((await svcErr('padh_guest_home', [randomUUID()]))?.code).toBe('GM009');
  });

  it('stay info: the password is stored and returned only as ciphertext; phones and times validated', async () => {
    await staff(w.A.owner, 'padh_set_stay', ['Rajmahal_Guest', '\\xaabbcc01', '11:00 AM', '7 to 10:30 AM', '9999900000', '9999911111']);
    const st = await svc<any>('padh_guest_stay', [sA]);
    expect(st).toMatchObject({ wifi_name: 'Rajmahal_Guest', wifi_password_enc: 'aabbcc01', checkout_time: '11:00 AM', breakfast: '7 to 10:30 AM', diet: 'jain' });
    await staff(w.A.owner, 'padh_set_stay', ['Rajmahal_Guest', null, null, null, null, null]); // null password keeps it
    expect((await svc<any>('padh_guest_stay', [sA])).wifi_password_enc).toBe('aabbcc01');
    expect((await staffErr(w.A.owner, 'padh_set_stay', ['x', null, null, null, '12ab', null]))?.code).toBe('GM015');
    expect((await staffErr(w.A.waiter, 'padh_set_stay', ['x', null, null, null, null, null]))?.code).toBe('GM011');
    expect((await db.asErr('authenticated', w.A.owner, `select wifi_password_enc from public.hotel_settings`))?.code).toBe('42501');
  });
});

describe('guest request tracking', () => {
  it('a guest reads only their own request, with updates in order; the list is their own', async () => {
    const created = await svc<any>('padh_guest_create_request', [sA, 'housekeeping', 'Towels', null, false, 'idem-key-2']);
    await staff(w.A.waiter, 'padh_accept', [created.request_id, 1]);
    const g = await svc<any>('padh_guest_get_request', [sA, created.request_id]);
    expect(g.request).toMatchObject({ status: 'accepted', team: 'housekeeping', version: 2 });
    expect(g.updates.map((u: any) => u.key)).toEqual(['msg.sent', 'msg.accepted']);
    expect(JSON.stringify(g)).not.toMatch(/session_id|idempotency|restaurant_id/);
    expect((await svcErr('padh_guest_get_request', [sA2, created.request_id]))?.code).toBe('GM012');
    expect((await svcErr('padh_guest_get_request', [sB, created.request_id]))?.code).toBe('GM012');
    const list = await svc<any[]>('padh_guest_list_requests', [sA]);
    expect(list.map((r) => r.label)).toEqual(['Towels', 'Cab']);
    expect(await svc<any[]>('padh_guest_list_requests', [sA2])).toEqual([]);
  });
});

describe('desk board', () => {
  it('shows the team\'s requests with room, guest and diet; kitchen gets no phone number and only kitchen items; others stay out', async () => {
    const f = await svc<any>('padh_guest_create_request', [sA, 'errand', 'Gift', null, false, 'idem-key-3']);
    await db.admin(`update public.requests set type = 'food', team = 'kitchen' where id = $1`, [f.request_id]);
    const mine = await staff(w.A.waiter, 'padh_staff_board', []);
    expect(mine.role).toBe('waiter');
    const labels = mine.requests.map((r: any) => r.label).sort();
    expect(labels).toEqual(['Cab', 'Gift', 'Towels']);
    const towels = mine.requests.find((r: any) => r.label === 'Towels');
    expect(towels).toMatchObject({ room: '204', guest_name: 'Anita', diet: 'jain', mobile_enc: 'deadbeef', mobile_cc: '+91', status: 'accepted' });
    const k = await staff(w.A.kitchen, 'padh_staff_board', []);
    expect(k.requests.map((r: any) => r.label)).toEqual(['Gift']);
    expect(k.requests[0].mobile_enc).toBeNull();
    expect((await staff(w.B.manager, 'padh_staff_board', [])).requests).toEqual([]);
    expect((await staffErr(w.stranger, 'padh_staff_board', []))?.code).toBe('GM011');
    expect((await db.asErr('anon', null, `select public.padh_staff_board()`))?.code).toBe('42501');
  });

  it('privileges: guest functions are service-role only, staff functions authenticated only', async () => {
    for (const q of [`select public.padh_guest_home($1)`, `select public.padh_guest_stay($1)`, `select public.padh_guest_list_requests($1)`])
      expect((await db.asErr('authenticated', w.A.owner, q, [sA]))?.code, q).toBe('42501');
    expect((await db.asErr('service_role', null, `select public.padh_staff_board()`))?.code).toBe('42501');
    void roomA;
  });
});
