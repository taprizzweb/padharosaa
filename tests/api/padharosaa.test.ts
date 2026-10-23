import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, type World } from '../../supabase/tests/helpers/fixtures';
import { APP, authState, state } from './helpers';
import { decryptText } from '@/lib/padharosaa/crypto';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
vi.mock('@/lib/supabase/server', async () => {
  const h = await import('./helpers');
  return { userClient: async () => h.fakeUserClient };
});
import { GET as publicGET } from '@/app/api/padharosaa/v1/hotels/[slug]/public/route';
import { POST as loginPOST } from '@/app/api/padharosaa/v1/hotels/[slug]/sessions/route';
import { GET as meGET } from '@/app/api/padharosaa/v1/sessions/me/route';
import { POST as logoutPOST } from '@/app/api/padharosaa/v1/sessions/me/logout/route';
import { POST as prefsPOST } from '@/app/api/padharosaa/v1/sessions/me/preferences/route';
import { GET as messagesGET } from '@/app/api/padharosaa/v1/chat/messages/route';
import { GET as contactsGET } from '@/app/api/padharosaa/v1/contacts/route';
import { POST as createPOST } from '@/app/api/padharosaa/v1/requests/route';
import { POST as guestActionPOST } from '@/app/api/padharosaa/v1/requests/[id]/[action]/route';
import { POST as staffReqPOST } from '@/app/api/padharosaa/v1/staff/requests/[id]/[action]/route';
import { POST as staffSessPOST } from '@/app/api/padharosaa/v1/staff/sessions/[id]/[action]/route';
import { POST as staffRoomPOST } from '@/app/api/padharosaa/v1/staff/rooms/[id]/[action]/route';
import { serverEnv } from '@/env';
import { GET as settingsGET } from '@/app/api/padharosaa/v1/staff/settings/route';
import { GET as roomsGET, POST as roomsPOST } from '@/app/api/padharosaa/v1/staff/rooms/route';
import { POST as rotatePOST } from '@/app/api/padharosaa/v1/staff/qr/rotate/route';
import { POST as enablePOST } from '@/app/api/padharosaa/v1/platform/hotels/[id]/enable/route';

let db: TestDb;
let w: World;
let keyA: string;
let keyB: string;
let roomId: string;
const COOKIE = '__Host-padh_sid';

beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
  roomId = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'204') returning id`, [w.A.rid]))[0]!.id;
  await db.admin(`insert into public.rooms (restaurant_id, number) values ($1,'204')`, [w.B.rid]);
});
afterAll(async () => db.close());
beforeEach(async () => {
  authState.userId = null;
  await db.admin(`delete from public.rate_limits`);
});

interface R { method?: string; body?: unknown; cookie?: string; origin?: string | null; idem?: string; ip?: string; contentType?: string | null }
function mk(path: string, o: R = {}): Request {
  const method = o.method ?? (o.body === undefined ? 'GET' : 'POST');
  const h = new Headers();
  if (method === 'POST') {
    if (o.origin !== null) h.set('origin', o.origin ?? APP);
    if (o.contentType !== null) h.set('content-type', o.contentType ?? 'application/json');
  }
  if (o.cookie) h.set('cookie', o.cookie);
  if (o.idem) h.set('idempotency-key', o.idem);
  h.set('x-forwarded-for', o.ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}`);
  return new Request(`${APP}${path}`, { method, headers: h, body: method === 'POST' ? JSON.stringify(o.body ?? {}) : undefined });
}
const p = <T extends object>(x: T) => ({ params: Promise.resolve(x) });
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const cookieOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
const pair = (r: Response) => cookieOf(r)!.split(';')[0]!;

const loginBody = (o: Record<string, unknown> = {}) => ({ k: keyA, name: 'Anita Sharma', cc: '+91', mobile: '98765 43210', room: '204', ...o });
const login = (o: Record<string, unknown> = {}, r: R = {}) => loginPOST(mk(`/api/padharosaa/v1/hotels/${w.A.slug}/sessions`, { ...r, body: loginBody(o) }), p({ slug: w.A.slug }));
async function guest(mobile = '9811111111') {
  const res = await login({ mobile });
  expect(res.status).toBe(200);
  return pair(res);
}
const create = (cookie: string, body: Record<string, unknown>, idem = randomUUID()) => createPOST(mk('/api/padharosaa/v1/requests', { body, cookie, idem }));
const mkRequest = async (cookie: string, type = 'housekeeping', label = 'Towels') => (await json(await create(cookie, { type, label }))).request_id as string;
const as = (uid: string | null) => { authState.userId = uid; };

describe('platform + public page', () => {
  it('only a platform admin can enable a hotel; the QR key is returned once', async () => {
    const path = `/api/padharosaa/v1/platform/hotels/${w.A.rid}/enable`;
    as(null);
    expect((await enablePOST(mk(path, { body: {} }), p({ id: w.A.rid }))).status).toBe(401);
    as(w.A.owner);
    expect((await enablePOST(mk(path, { body: {} }), p({ id: w.A.rid }))).status).toBe(403);
    as(w.admin);
    const res = await enablePOST(mk(path, { body: {} }), p({ id: w.A.rid }));
    expect(res.status).toBe(200);
    keyA = (await json(res)).qr_key;
    expect(keyA).toMatch(/^[0-9a-f]{64}$/);
    expect((await json(await enablePOST(mk(path, { body: {} }), p({ id: w.A.rid })))).qr_key).toBeNull();
    expect((await enablePOST(mk(`/api/padharosaa/v1/platform/hotels/not-a-uuid/enable`, { body: {} }), p({ id: 'not-a-uuid' }))).status).toBe(404);
    keyB = (await json(await enablePOST(mk(`/api/padharosaa/v1/platform/hotels/${w.B.rid}/enable`, { body: {} }), p({ id: w.B.rid })))).qr_key;
  });

  it('serves the login page data for a valid key and gives every failure the same answer', async () => {
    const ok = await publicGET(mk(`/api/padharosaa/v1/hotels/${w.A.slug}/public?k=${keyA}`), p({ slug: w.A.slug }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const b = await json(ok);
    expect(b).toMatchObject({ name: 'Cafe Aroma', verification_level: 'light' });
    expect(JSON.stringify(b)).not.toMatch(/phone|mobile/i);
    const bodies: string[] = [];
    for (const [slug, k] of [[w.A.slug, 'f'.repeat(64)], ['nope-hotel', keyA], [w.A.slug, 'short'], [w.A.slug, '']] as const) {
      const r = await publicGET(mk(`/api/padharosaa/v1/hotels/${slug}/public?k=${k}`), p({ slug }));
      expect(r.status, `${slug}/${k}`).toBe(403);
      bodies.push(JSON.stringify((await json(r)).error));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('throttles a client that keeps guessing keys', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}-guess`;
    for (let i = 0; i < 30; i++) await publicGET(mk(`/api/padharosaa/v1/hotels/${w.A.slug}/public?k=${'e'.repeat(63)}${i % 10}`, { ip }), p({ slug: w.A.slug }));
    const r = await publicGET(mk(`/api/padharosaa/v1/hotels/${w.A.slug}/public?k=${keyA}`, { ip }), p({ slug: w.A.slug }));
    expect(r.status).toBe(429);
  });
});

describe('guest login', () => {
  it('creates a session with a hardened cookie; the mobile number is stored encrypted, the token only as a hash', async () => {
    const res = await login({ mobile: '9822222222', consent: true, consent_version: 'v1' });
    expect(res.status).toBe(200);
    const sc = cookieOf(res)!;
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=lax/i);
    expect(sc).toMatch(/Path=\/(;|$)/);
    expect(sc).not.toMatch(/Domain=/i);
    const token = sc.split(';')[0]!.split('=')[1]!;
    const b = await json(res);
    expect(JSON.stringify(b)).not.toContain(token);
    const row = (await db.admin<any>(`select * from public.guest_sessions where guest_name = 'Anita Sharma' and consent_messaging order by started_at desc limit 1`))[0];
    expect(decryptText(Buffer.from(row.mobile_enc))).toBe('+919822222222');
    expect(Buffer.from(row.mobile_enc).toString('latin1')).not.toContain('9822222222');
    expect(Buffer.from(row.token_hash).toString('utf8')).not.toContain(token);
    expect(row.token_hash.length).toBe(32);
  });

  it('the same device logging in again resumes without a new cookie or a duplicate session', async () => {
    const c = await guest('9833333333');
    const before = (await db.admin<any>(`select count(*)::int n from public.guest_sessions`))[0].n;
    const again = await login({ mobile: '9833333333', language: 'hi' }, { cookie: c });
    expect(await json(again)).toMatchObject({ ok: true, resumed: true, language: 'hi' });
    expect(cookieOf(again)).toBeUndefined();
    expect((await db.admin<any>(`select count(*)::int n from public.guest_sessions`))[0].n).toBe(before);
  });

  it('rejects bad input before touching the database, and maps credential failures to clear errors', async () => {
    for (const bad of [{ mobile: '12345' }, { name: 'A' }, { k: 'zz' }, { language: 'xx' }, { room: '' }, { extra: 1 }]) {
      const r = await login(bad as never);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(cookieOf(r)).toBeUndefined();
    }
    const unknown = await login({ room: '999' });
    expect([unknown.status, (await json(unknown)).error.key]).toEqual([422, 'unknown_room']);
    const wrongKey = await login({ k: 'a'.repeat(64) });
    expect([wrongKey.status, (await json(wrongKey)).error.key]).toEqual([403, 'invalid_table_token']);
    // hotel B's key does not open hotel A
    const crossKey = await login({ k: keyB });
    expect([crossKey.status, (await json(crossKey)).error.key]).toEqual([403, 'invalid_table_token']);
  });

  it('refuses cross-origin and non-JSON posts (CSRF) and oversized bodies', async () => {
    expect((await login({}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await login({}, { origin: null })).status).toBe(403);
    expect((await login({}, { contentType: 'text/plain' })).status).toBe(415);
    const big = await loginPOST(mk(`/api/padharosaa/v1/hotels/${w.A.slug}/sessions`, { body: { ...loginBody(), name: 'x'.repeat(20000) } }), p({ slug: w.A.slug }));
    expect(big.status).toBe(413);
  });
});

describe('guest session endpoints', () => {
  it('need a valid cookie: none, garbage, forged or logged-out all answer 401', async () => {
    const c = await guest('9844444444');
    expect((await meGET(mk('/api/padharosaa/v1/sessions/me'))).status).toBe(401);
    expect((await meGET(mk('/api/padharosaa/v1/sessions/me', { cookie: `${COOKIE}=garbage` }))).status).toBe(401);
    expect((await meGET(mk('/api/padharosaa/v1/sessions/me', { cookie: `${COOKIE}=${'A'.repeat(43)}` }))).status).toBe(401);
    const me = await meGET(mk('/api/padharosaa/v1/sessions/me', { cookie: c }));
    expect(me.status).toBe(200);
    const b = await json(me);
    expect(b).toMatchObject({ room: '204', name: 'Anita Sharma', hotel_name: 'Cafe Aroma' });
    expect(JSON.stringify(b)).not.toMatch(/mobile|token|restaurant_id|9844444444/i);
    const out = await logoutPOST(mk('/api/padharosaa/v1/sessions/me/logout', { body: {}, cookie: c }));
    expect(out.status).toBe(200);
    expect(cookieOf(out)).toMatch(/Max-Age=0/);
    expect((await meGET(mk('/api/padharosaa/v1/sessions/me', { cookie: c }))).status).toBe(401);
  });

  it('contacts, preferences and chat history work for a live session', async () => {
    const c = await guest('9855555555');
    await db.admin(`update public.hotel_settings set reception_phone = '9999900000' where restaurant_id = $1`, [w.A.rid]);
    expect((await json(await contactsGET(mk('/api/padharosaa/v1/contacts', { cookie: c })))).reception).toBe('9999900000');
    expect((await contactsGET(mk('/api/padharosaa/v1/contacts'))).status).toBe(401);
    expect((await prefsPOST(mk('/api/padharosaa/v1/sessions/me/preferences', { body: { diet: 'jain', occasion: 'birthday' }, cookie: c }))).status).toBe(200);
    expect((await prefsPOST(mk('/api/padharosaa/v1/sessions/me/preferences', { body: { diet: 'carnivore' }, cookie: c }))).status).toBe(400);
    const msgs = await json(await messagesGET(mk('/api/padharosaa/v1/chat/messages?limit=10', { cookie: c })));
    expect(msgs.messages[0].body).toBe('chat.welcome');
    expect((await messagesGET(mk('/api/padharosaa/v1/chat/messages?limit=500', { cookie: c }))).status).toBe(400);
  });

  it('create request: needs an Idempotency-Key, replays safely, rejects food/system types, strips bidi text', async () => {
    const c = await guest('9866666666');
    const noKey = await createPOST(mk('/api/padharosaa/v1/requests', { body: { type: 'cab', label: 'Cab' }, cookie: c }));
    expect(noKey.status).toBe(400);
    const key = randomUUID();
    const a = await create(c, { type: 'wake', label: 'Wake-up 6:00 AM' }, key);
    expect(a.status).toBe(201);
    const b = await create(c, { type: 'wake', label: 'Wake-up 6:00 AM' }, key);
    expect(b.status).toBe(200);
    expect((await json(b)).request_id).toBe((await json(a)).request_id);
    for (const type of ['food', 'chat_message', 'feedback_alert']) expect((await create(c, { type, label: 'x' })).status, type).toBe(400);
    const clean = await json(await create(c, { type: 'errand', label: 'Gift‮evil', detail: 'a\u0007b' }));
    const row = (await db.admin<any>(`select label, detail from public.requests where id = $1`, [clean.request_id]))[0];
    expect([row.label, row.detail]).toEqual(['Giftevil', 'ab']);
    expect((await createPOST(mk('/api/padharosaa/v1/requests', { body: { type: 'cab', label: 'Cab' }, idem: randomUUID() }))).status).toBe(401);
  });

  it('guests can cancel only their own request, and only while received', async () => {
    const c1 = await guest('9877777771');
    const c2 = await guest('9877777772');
    const id = await mkRequest(c1, 'late_checkout', 'Late check-out');
    const url = (i: string, a: string) => `/api/padharosaa/v1/requests/${i}/${a}`;
    expect((await guestActionPOST(mk(url(id, 'cancel'), { body: {}, cookie: c2 }), p({ id, action: 'cancel' }))).status).toBe(404);
    expect((await guestActionPOST(mk(url(id, 'cancel'), { body: {}, cookie: c1 }), p({ id, action: 'cancel' }))).status).toBe(200);
    expect((await guestActionPOST(mk(url(id, 'cancel'), { body: {}, cookie: c1 }), p({ id, action: 'cancel' }))).status).toBe(409);
    expect((await guestActionPOST(mk(url(id, 'explode'), { body: {}, cookie: c1 }), p({ id, action: 'explode' }))).status).toBe(404);
    expect((await guestActionPOST(mk(url('nope', 'cancel'), { body: {}, cookie: c1 }), p({ id: 'nope', action: 'cancel' }))).status).toBe(404);
  });
});

describe('staff actions over the API', () => {
  const act = (id: string, action: string, body: unknown) => staffReqPOST(mk(`/api/padharosaa/v1/staff/requests/${id}/${action}`, { body }), p({ id, action }));

  it('need a signed-in staff member of the right hotel; stale versions answer 409; dismissing needs a reason', async () => {
    const c = await guest('9888888881');
    const id = await mkRequest(c, 'cab', 'Cab to airport');
    as(null);
    expect((await act(id, 'accept', { version: 1 })).status).toBe(401);
    as(w.stranger);
    expect((await act(id, 'accept', { version: 1 })).status).toBe(403);
    as(w.B.manager);
    expect((await act(id, 'accept', { version: 1 })).status).toBe(404); // other hotel: looks like it does not exist
    as(w.A.waiter);
    expect((await act(id, 'dismiss', { version: 1 })).status).toBe(400);
    expect((await act(id, 'dismiss', { version: 1, reason: 'no' })).status).toBe(400);
    expect((await act(id, 'accept', { version: 1, extra: true })).status).toBe(400);
    const ok = await act(id, 'accept', { version: 1 });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ status: 'accepted', version: 2 });
    expect((await act(id, 'complete', { version: 1 })).status).toBe(409); // stale
    expect((await act(id, 'complete', { version: 2 })).status).toBe(200);
    expect((await act(id, 'launch', { version: 1 })).status).toBe(404);
  });

  it('dismiss reaches the guest\'s chat with the reason; pass and resolve work; help "not yet" escalates', async () => {
    const c = await guest('9888888882');
    const id = await mkRequest(c, 'reservation', 'Table for 4');
    as(w.A.waiter);
    expect((await act(id, 'dismiss', { version: 1, reason: 'slot_full' })).status).toBe(200);
    const msgs = (await json(await messagesGET(mk('/api/padharosaa/v1/chat/messages', { cookie: c })))).messages as any[];
    expect(msgs.find((m) => m.body === 'msg.dismissed')?.params).toMatchObject({ reason: 'slot_full', preset: true });

    const e = await mkRequest(c, 'errand', 'Fix lamp');
    expect(await json(await act(e, 'pass', { version: 1, team: 'maintenance' }))).toMatchObject({ team: 'maintenance', status: 'received' });
    expect((await act(e, 'pass', { version: 2, team: 'janitor' })).status).toBe(400);

    const h = await mkRequest(c, 'help', 'Hot water');
    expect((await act(h, 'resolve', { version: 1, outcome: 'fixed' })).status).toBe(200);
    const no = await guestActionPOST(mk(`/api/padharosaa/v1/requests/${h}/confirm`, { body: { ok: false }, cookie: c }), p({ id: h, action: 'confirm' }));
    expect(await json(no)).toMatchObject({ escalated: true });
    expect((await guestActionPOST(mk(`/api/padharosaa/v1/requests/${h}/confirm`, { body: {}, cookie: c }), p({ id: h, action: 'confirm' }))).status).toBe(400);
  });

  it('without the data key a guest gets a clear 503, never a raw 500, and managers are warned', async () => {
    const env = serverEnv() as { PADHAROSAA_DATA_KEY?: string }; // the validated environment is cached, so change it there
    const key = env.PADHAROSAA_DATA_KEY;
    env.PADHAROSAA_DATA_KEY = undefined;
    try {
      const res = await login({ mobile: '9877777777' });
      expect(res.status).toBe(503);
      expect((await json(res)).error.key).toBe('not_configured');
      as(w.A.manager);
      expect((await json(await settingsGET(mk('/api/padharosaa/v1/staff/settings')))).server_ready).toBe(false);
    } finally {
      env.PADHAROSAA_DATA_KEY = key;
    }
    as(w.A.manager);
    expect((await json(await settingsGET(mk('/api/padharosaa/v1/staff/settings')))).server_ready).toBe(true);
  });
  it('rooms: managers add them, desk staff list them, and a room can be switched off and on', async () => {
    const add = (numbers: unknown) => roomsPOST(mk('/api/padharosaa/v1/staff/rooms', { body: { numbers } }));
    expect((await add(['301'])).status).toBe(401);
    as(w.A.kitchen);
    expect((await add(['301'])).status).toBe(403);
    as(w.A.manager);
    expect((await add(['301', '302'])).status).toBe(200);
    expect((await add(['<b>'])).status).toBe(400);
    expect((await add([])).status).toBe(400);
    expect((await add('301')).status).toBe(400);
    as(w.A.waiter);
    const list = (await json(await roomsGET(mk('/api/padharosaa/v1/staff/rooms')))).rooms as { id: string; number: string; active: boolean }[];
    expect(list.map((r) => r.number)).toEqual(expect.arrayContaining(['204', '301', '302']));
    const id = list.find((r) => r.number === '302')!.id;
    const toggle = (active: unknown) => staffRoomPOST(mk(`/api/padharosaa/v1/staff/rooms/${id}/active`, { body: { active } }), p({ id, action: 'active' }));
    expect((await toggle(false)).status).toBe(403); // only owner/manager
    as(w.A.manager);
    expect((await toggle('no')).status).toBe(400);
    expect((await toggle(false)).status).toBe(200);
    expect((await db.admin<any>(`select active from public.rooms where id = $1`, [id]))[0].active).toBe(false);
    as(w.B.manager);
    expect((await toggle(true)).status).toBe(404); // another hotel's room
    expect((await json(await roomsGET(mk('/api/padharosaa/v1/staff/rooms')))).rooms.map((r: any) => r.number)).not.toContain('302');
  });
  it('end/block sessions, stay codes, check-out and QR rotation are role- and hotel-scoped', async () => {
    const c = await guest('9888888883');
    const sid = (await db.admin<any>(`select id from public.guest_sessions order by started_at desc limit 1`))[0].id as string;
    const sess = (id: string, action: string) => staffSessPOST(mk(`/api/padharosaa/v1/staff/sessions/${id}/${action}`, { body: {} }), p({ id, action }));
    const room = (id: string, action: string) => staffRoomPOST(mk(`/api/padharosaa/v1/staff/rooms/${id}/${action}`, { body: {} }), p({ id, action }));
    as(w.A.kitchen);
    expect((await sess(sid, 'end')).status).toBe(403);
    expect((await room(roomId, 'stay-code')).status).toBe(403);
    as(w.B.manager);
    expect((await sess(sid, 'end')).status).toBe(404);
    expect((await room(roomId, 'checkout')).status).toBe(404);
    as(w.A.waiter);
    const code = await json(await room(roomId, 'stay-code'));
    expect(code.code).toMatch(/^[0-9]{4}$/);
    expect((await room(roomId, 'launch')).status).toBe(404);
    expect((await sess(sid, 'end')).status).toBe(200);
    expect((await meGET(mk('/api/padharosaa/v1/sessions/me', { cookie: c }))).status).toBe(401);
    // the QR key: waiter may not, manager must type ROTATE
    const rotate = (confirm: string) => rotatePOST(mk('/api/padharosaa/v1/staff/qr/rotate', { body: { confirm } }));
    expect((await rotate('ROTATE')).status).toBe(403);
    as(w.A.manager);
    expect((await rotate('rotate')).status).toBe(400);
    const r = await rotate('ROTATE');
    expect(r.status).toBe(200);
    const newKey = (await json(r)).qr_key as string;
    expect((await publicGET(mk(`/api/padharosaa/v1/hotels/${w.A.slug}/public?k=${keyA}`), p({ slug: w.A.slug }))).status).toBe(403);
    expect((await publicGET(mk(`/api/padharosaa/v1/hotels/${w.A.slug}/public?k=${newKey}`), p({ slug: w.A.slug }))).status).toBe(200);
    keyA = newKey;
  });

  it('responses never contain the service-role key, cookie secret, or raw IPs', async () => {
    const c = await guest('9888888884');
    const res = await meGET(mk('/api/padharosaa/v1/sessions/me', { cookie: c, ip: '192.0.2.77' }));
    const text = await res.text();
    for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY!, process.env.GUEST_COOKIE_SECRET!, process.env.PADHAROSAA_DATA_KEY!, '192.0.2.77']) expect(text).not.toContain(secret);
  });
});
