import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, type World } from '../../supabase/tests/helpers/fixtures';
import { APP, authState, state } from './helpers';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
vi.mock('@/lib/supabase/server', async () => {
  const h = await import('./helpers');
  return { userClient: async () => h.fakeUserClient };
});
import { POST as loginPOST } from '@/app/api/padharosaa/v1/hotels/[slug]/sessions/route';
import { POST as foodPOST } from '@/app/api/padharosaa/v1/requests/food/route';
import { POST as helpPOST } from '@/app/api/padharosaa/v1/requests/help/route';
import { POST as staffReqPOST } from '@/app/api/padharosaa/v1/staff/requests/[id]/[action]/route';
import { POST as diningPOST } from '@/app/api/padharosaa/v1/staff/dining/route';
import { GET as teamGET } from '@/app/api/padharosaa/v1/staff/team/route';
import { POST as profilePOST } from '@/app/api/padharosaa/v1/staff/team/[user]/route';
import { POST as importPOST } from '@/app/api/padharosaa/v1/staff/team/import/route';
import { GET as alertsGET, POST as alertsPOST } from '@/app/api/padharosaa/v1/staff/alerts/route';
import { GET as settingsGET } from '@/app/api/padharosaa/v1/staff/settings/route';
import { GET as diningGET } from '@/app/api/padharosaa/v1/dining/route';
import { POST as enablePOST } from '@/app/api/padharosaa/v1/platform/hotels/[id]/enable/route';

let db: TestDb;
let w: World;
let key: string;
beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
  await db.admin(`insert into public.rooms (restaurant_id, number) values ($1,'204')`, [w.A.rid]);
  authState.userId = w.admin;
  const r = await enablePOST(mk(`/x`, { body: {} }), p({ id: w.A.rid }));
  key = ((await r.json()) as any).qr_key;
});
afterAll(async () => db.close());
beforeEach(async () => { authState.userId = null; await db.admin(`delete from public.rate_limits`); });

function mk(path: string, o: { body?: unknown; cookie?: string; idem?: string; method?: string } = {}): Request {
  const method = o.method ?? (o.body === undefined ? 'GET' : 'POST');
  const h = new Headers({ 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250) + 1}` });
  if (method === 'POST') { h.set('origin', APP); h.set('content-type', 'application/json'); }
  if (o.cookie) h.set('cookie', o.cookie);
  if (o.idem) h.set('idempotency-key', o.idem);
  return new Request(`${APP}${path}`, { method, headers: h, body: method === 'POST' ? JSON.stringify(o.body ?? {}) : undefined });
}
const p = <T extends object>(x: T) => ({ params: Promise.resolve(x) });
const as = (uid: string | null) => { authState.userId = uid; };
async function guest(): Promise<string> {
  const res = await loginPOST(mk(`/l`, { body: { k: key, name: 'Anita Sharma', cc: '+91', mobile: '9811111111', room: '204' } }), p({ slug: w.A.slug }));
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().find((c) => c.startsWith('__Host-padh_sid='))!.split(';')[0]!;
}

describe('food, handover and dining', () => {
  it('guest orders food; kitchen chooses delivery; with room dining off the same choice is refused', async () => {
    const cookie = await guest();
    const idem = randomUUID();
    const res = await foodPOST(mk('/f', { body: { label: 'Dinner: 2 thali' }, cookie, idem }));
    expect(res.status).toBe(201);
    const f = (await res.json()) as any;
    expect((await foodPOST(mk('/f', { body: { label: 'Dinner: 2 thali' }, cookie, idem }))).status).toBe(200); // replay
    expect((await foodPOST(mk('/f', { body: { label: 'x' }, cookie }))).status).toBe(400); // no idempotency key
    expect((await foodPOST(mk('/f', { body: { label: 'x' }, idem: randomUUID() }))).status).toBe(401); // not signed in

    as(w.A.kitchen);
    const ok = await staffReqPOST(mk('/h', { body: { version: f.version, mode: 'deliver' } }), p({ id: f.request_id, action: 'handover' }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).handover).toBe('deliver');

    as(w.A.kitchen);
    expect((await diningPOST(mk('/d', { body: { room_dining: false } }))).status).toBe(403); // kitchen cannot switch it
    as(w.A.manager);
    expect((await diningPOST(mk('/d', { body: { room_dining: false } }))).status).toBe(200);
    const f2 = (await (await foodPOST(mk('/f', { body: { label: 'Tea' }, cookie, idem: randomUUID() }))).json()) as any;
    as(w.A.kitchen);
    expect((await staffReqPOST(mk('/h', { body: { version: f2.version, mode: 'deliver' } }), p({ id: f2.request_id, action: 'handover' }))).status).toBe(400);
    expect((await staffReqPOST(mk('/h', { body: { version: f2.version, mode: 'takeaway' } }), p({ id: f2.request_id, action: 'handover' }))).status).toBe(200);
    expect((await staffReqPOST(mk('/h', { body: { version: 99, mode: 'takeaway' } }), p({ id: f2.request_id, action: 'handover' }))).status).toBe(409);
    expect((await staffReqPOST(mk('/h', { body: { version: 1, mode: 'bike' } }), p({ id: f2.request_id, action: 'handover' }))).status).toBe(400);
  });

  it('a problem report queues a WhatsApp alert for the reception head only after the manager sets one up', async () => {
    const cookie = await guest();
    as(w.A.manager);
    expect((await profilePOST(mk('/t', { body: { department: 'front_desk', whatsapp: '+91 98111-22233', is_head: true } }), p({ user: w.A.waiter }))).status).toBe(200);
    const res = await helpPOST(mk('/h', { body: { categories: ['ac_electrical', 'wifi'], detail: 'Router light is red', urgent: true }, cookie, idem: randomUUID() }));
    expect(res.status).toBe(201);
    const id = ((await res.json()) as any).request_id;
    const n = await db.admin<any>(`select to_ref, template from public.notifications where payload->>'request_id' = $1`, [id]);
    expect(n).toEqual([{ to_ref: w.A.waiter, template: 'help_alert' }]);
    expect((await helpPOST(mk('/h', { body: { categories: ['ghosts'] }, cookie, idem: randomUUID() }))).status).toBe(400);
    expect((await helpPOST(mk('/h', { body: { categories: [] }, cookie, idem: randomUUID() }))).status).toBe(400); // needs a chip or a note
    expect((await helpPOST(mk('/h', { body: { categories: [], detail: 'Please send someone' }, cookie, idem: randomUUID() }))).status).toBe(201);
  });
});

describe('dining link and chips', () => {
  it('builds the menu address with the room and a back link, and lists only categories that have something to order', async () => {
    const cookie = await guest();
    const cat = (await db.admin<{ id: string }>(`select id from public.categories where restaurant_id = $1 limit 1`, [w.A.rid]))[0]!.id;
    await db.admin(`insert into public.categories (restaurant_id, name_en, name_hi) values ($1, 'Empty one', 'x')`, [w.A.rid]);
    // no menu link and no room-service link yet: nothing to open
    expect(((await (await diningGET(mk('/d', { cookie }))).json()) as any).available).toBe(false);
    // the hotel's own restaurant on its room-service link
    const token = 'a'.repeat(64);
    await db.admin(`update public.restaurants set room_token = $2 where id = $1`, [w.A.rid, token]);
    const own = (await (await diningGET(mk('/d', { cookie }))).json()) as any;
    expect(own.available).toBe(true);
    const u = new URL(own.base);
    expect(u.pathname).toBe(`/${w.A.slug}`);
    expect(u.searchParams.get('k')).toBe(token);
    expect(u.searchParams.get('room')).toBe('204');
    expect(u.searchParams.get('back')).toBe(`${APP}/padharosaa/${w.A.slug}`);
    expect(own.chips.map((c: any) => c.id)).toContain(cat);
    expect(own.chips.map((c: any) => c.name)).not.toContain('Empty one');
    // a separate cafe link pasted by the manager wins; a link that is not https is ignored
    await db.admin(`update public.hotel_settings set menu_url = 'https://menu.taprizz.in/${w.A.slug}?k=${token}' where restaurant_id = $1`, [w.A.rid]);
    expect(new URL(((await (await diningGET(mk('/d', { cookie }))).json()) as any).base).host).toBe('menu.taprizz.in');
    await db.admin(`alter table public.hotel_settings drop constraint if exists hotel_settings_menu_url_check`);
    await db.admin(`update public.hotel_settings set menu_url = 'http://insecure.example/${w.A.slug}' where restaurant_id = $1`, [w.A.rid]);
    expect(new URL(((await (await diningGET(mk('/d', { cookie }))).json()) as any).base).pathname).toBe(`/${w.A.slug}`); // fell back to the hotel's own menu
    expect((await diningGET(mk('/d'))).status).toBe(401);
  });
});

describe('manager settings read', () => {
  it('owner and manager read the editable settings (never the Wi-Fi password); waiter and kitchen cannot', async () => {
    as(w.A.manager);
    const r = await settingsGET(mk('/s'));
    expect(r.status).toBe(200);
    const b = (await r.json()) as any;
    expect(b).toHaveProperty('room_dining');
    expect(JSON.stringify(b)).not.toMatch(/password|_enc/i);
    for (const uid of [w.A.waiter, w.A.kitchen]) { as(uid); expect((await settingsGET(mk('/s'))).status, uid).toBeGreaterThanOrEqual(400); }
    as(null);
    expect((await settingsGET(mk('/s'))).status).toBe(401);
  });
});

describe('staff directory, import and alerts', () => {
  it('only a manager or owner reads the directory; mutes are personal', async () => {
    as(w.A.kitchen);
    expect((await teamGET(mk('/t'))).status).toBeGreaterThanOrEqual(400);
    as(w.A.manager);
    const d = (await (await teamGET(mk('/t'))).json()) as any;
    expect(d.staff.length).toBeGreaterThan(2);
    expect(JSON.stringify(d)).not.toMatch(/password/i);
    expect((await alertsPOST(mk('/a', { body: { team: 'kitchen', muted: true } }))).status).toBe(200);
    expect(((await (await alertsGET(mk('/a'))).json()) as any).muted).toEqual(['kitchen']);
    as(w.A.waiter);
    expect(((await (await alertsGET(mk('/a'))).json()) as any).muted).toEqual([]);
    expect((await alertsPOST(mk('/a', { body: { team: 'spa', muted: true } }))).status).toBe(400);
  });

  it('adding one person: a plain 10-digit WhatsApp is saved as +91; a bad number is said to be invalid and leaves no login behind', async () => {
    as(w.A.owner);
    const one = (row: Record<string, unknown>) => importPOST(mk('/i', { body: { rows: [row] } }));
    const ok = await one({ name: 'Kiran', email: 'kiran@haveli.test', department: 'kitchen', whatsapp: '9828114008', is_head: false });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as any).results[0].ok).toBe(true);
    expect((await db.admin<any>(`select p.whatsapp from public.staff_profiles p join auth.users u on u.id = p.user_id where u.email = 'kiran@haveli.test'`))[0].whatsapp).toBe('+919828114008');
    const bad = await one({ name: 'Bad', email: 'bad@haveli.test', department: 'kitchen', whatsapp: '12', is_head: false });
    expect(bad.status).toBe(400); // refused before any login is made
    expect((await db.admin<any>(`select 1 from auth.users where email = 'bad@haveli.test'`)).length).toBe(0);
    // leave the hotel as it was for the next test
    await db.admin(`delete from public.staff where user_id = (select id from auth.users where email = 'kiran@haveli.test')`);
    await db.admin(`delete from auth.users where email = 'kiran@haveli.test'`);
  });

  it('owner imports people: logins with one-time temporary passwords, department and WhatsApp saved; duplicates reported; others refused', async () => {
    const body = { rows: [
      { name: 'Prakash', email: 'Prakash@haveli.test', department: 'maintenance', whatsapp: '+91 98111 00001', is_head: true },
      { name: 'Meera', email: 'meera@haveli.test', department: 'front_desk' },
      { name: 'Chef', email: 'chef@haveli.test', department: 'kitchen' },
    ] };
    as(w.A.manager);
    expect((await importPOST(mk('/i', { body }))).status).toBe(403); // owner only
    as(w.A.owner);
    const res = await importPOST(mk('/i', { body }));
    expect(res.status).toBe(201);
    const out = ((await res.json()) as any).results;
    expect(out.map((r: any) => r.ok)).toEqual([true, true, true]);
    for (const r of out) expect(r.temporary_password).toMatch(/^[A-Za-z0-9]{16}$/);
    const rows = await db.admin<any>(`select u.email, s.role, p.department, p.whatsapp, p.is_head from public.staff s join auth.users u on u.id = s.user_id join public.staff_profiles p on p.user_id = s.user_id where u.email like '%@haveli.test' order by u.email`);
    expect(rows).toEqual([
      { email: 'chef@haveli.test', role: 'kitchen', department: 'kitchen', whatsapp: null, is_head: false },
      { email: 'meera@haveli.test', role: 'waiter', department: 'front_desk', whatsapp: null, is_head: false },
      { email: 'prakash@haveli.test', role: 'waiter', department: 'maintenance', whatsapp: '+919811100001', is_head: true },
    ]);
    const again = ((await (await importPOST(mk('/i', { body: { rows: [body.rows[1]] } }))).json()) as any).results;
    expect(again).toEqual([{ email: 'meera@haveli.test', ok: false, error: 'exists' }]);
    expect((await importPOST(mk('/i', { body: { rows: [] } }))).status).toBe(400);
    expect((await importPOST(mk('/i', { body: { rows: [{ name: 'X', email: 'not-an-email', department: 'kitchen' }] } }))).status).toBe(400);
  });
});
