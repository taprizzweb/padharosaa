import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, placeOrder, type World } from '../../supabase/tests/helpers/fixtures';
import { APP, authState, req, state, uniqueIp } from './helpers';
import { GET as boardGET } from '@/app/api/staff/board/route';
import { GET as itemsGET } from '@/app/api/staff/items/route';
import { POST as statusPOST } from '@/app/api/staff/order-status/route';
import { POST as donePOST } from '@/app/api/staff/request-done/route';
import { POST as helpDonePOST } from '@/app/api/staff/help-done/route';
import { POST as closePOST } from '@/app/api/staff/close-session/route';
import { POST as availPOST } from '@/app/api/staff/availability/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as logoutPOST } from '@/app/api/auth/logout/route';
import { POST as orderPOST } from '@/app/api/guest/order/route';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
vi.mock('@/lib/supabase/server', async () => {
  const h = await import('./helpers');
  return { userClient: async () => h.fakeUserClient };
});

let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
});
afterAll(async () => db.close());
beforeEach(() => {
  authState.userId = null;
  authState.signOuts.length = 0;
});

const as = (uid: string | null) => {
  authState.userId = uid;
};
const json = async (r: Response) => (await r.json()) as Record<string, any>;
async function newOrder(t: 'A' | 'B' = 'A') {
  const ten = w[t];
  const [row] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning id, qr_token`, [ten.rid, `S${randomUUID().slice(0, 5)}`]);
  const o = await placeOrder(db, ten, { token: row!.qr_token }, [{ item_id: ten.chai, qty: 1 }]);
  return { ...o, tableId: row!.id, token: row!.qr_token };
}
const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, o = {}) => handler(req(path, body, o));

describe('GET /api/staff/board', () => {
  it('needs a signed-in staff member', async () => {
    expect((await boardGET(req('/api/staff/board'))).status).toBe(401);
    as(w.stranger);
    const r = await boardGET(req('/api/staff/board'));
    expect(r.status).toBe(403);
    expect((await json(r)).error.key).toBe('forbidden');
  });
  it('returns the live board for the staff member\'s own restaurant only, never cached', async () => {
    const mine = await newOrder('A');
    const theirs = await newOrder('B');
    as(w.A.waiter);
    const r = await boardGET(req('/api/staff/board'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const text = JSON.stringify(await json(r));
    expect(text).toContain(mine.order_id);
    expect(text).not.toContain(theirs.order_id);
  });
  it('is rate limited per user', async () => {
    as(w.B.manager);
    let last = 0;
    for (let i = 0; i < 62; i++) last = (await boardGET(req('/api/staff/board'))).status;
    expect(last).toBe(429);
  });
  it('rejects POST', async () => {
    as(w.A.owner);
    expect((await boardGET(req('/api/staff/board', {}))).status).toBe(405);
  });
});

describe('GET /api/staff/items', () => {
  it('lists the restaurant\'s dishes for every role', async () => {
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter, w.A.kitchen]) {
      as(uid);
      const b = await json(await itemsGET(req('/api/staff/items')));
      expect(b.items.map((i: any) => i.id).sort()).toEqual([w.A.paneer, w.A.chai, w.A.soldOut, w.A.platter].sort());
    }
    as(null);
    expect((await itemsGET(req('/api/staff/items'))).status).toBe(401);
  });
});

describe('POST /api/staff/order-status', () => {
  const call = (body: unknown, o = {}) => post(statusPOST, '/api/staff/order-status', body, o);

  it('advances an order through the whole flow', async () => {
    const o = await newOrder();
    as(w.A.kitchen);
    for (const s of ['preparing', 'ready', 'served']) {
      const r = await call({ order_id: o.order_id, status: s });
      expect(r.status, s).toBe(200);
      expect((await json(r)).status).toBe(s);
    }
  });
  it('rejects invalid transitions (409) and unknown ids (404)', async () => {
    const o = await newOrder();
    as(w.A.waiter);
    const skip = await call({ order_id: o.order_id, status: 'served' });
    expect(skip.status).toBe(409);
    expect((await json(skip)).error.key).toBe('invalid_transition');
    expect((await call({ order_id: randomUUID(), status: 'preparing' })).status).toBe(404);
  });
  it('kitchen cannot cancel (403); a reason is required to cancel (400); waiter can cancel', async () => {
    const o = await newOrder();
    as(w.A.kitchen);
    const k = await call({ order_id: o.order_id, status: 'cancelled', reason: 'no' });
    expect(k.status).toBe(403);
    expect((await json(k)).error.key).toBe('forbidden');
    as(w.A.waiter);
    const noReason = await call({ order_id: o.order_id, status: 'cancelled' });
    expect(noReason.status).toBe(400);
    expect((await json(noReason)).error.key).toBe('reason_required');
    expect((await call({ order_id: o.order_id, status: 'cancelled', reason: 'Guest changed their mind' })).status).toBe(200);
  });
  it('another restaurant\'s staff cannot touch the order (looks like not found)', async () => {
    const o = await newOrder('A');
    as(w.B.owner);
    expect((await call({ order_id: o.order_id, status: 'preparing' })).status).toBe(404);
    const [row] = await db.admin<{ status: string }>(`select status from public.orders where id = $1`, [o.order_id]);
    expect(row!.status).toBe('placed');
  });
  it('requires sign-in, our origin, JSON, a small body and a valid shape', async () => {
    const o = await newOrder();
    expect((await call({ order_id: o.order_id, status: 'preparing' })).status).toBe(401);
    as(w.A.waiter);
    expect((await call({ order_id: o.order_id, status: 'preparing' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call({ order_id: o.order_id, status: 'preparing' }, { origin: null })).status).toBe(403);
    expect((await call({ order_id: o.order_id, status: 'preparing' }, { contentType: 'text/plain' })).status).toBe(415);
    expect((await statusPOST(req('/api/staff/order-status', undefined, { method: 'POST', rawBody: '{"order_id":"' + 'x'.repeat(20000) + '"}' }))).status).toBe(413);
    for (const bad of [{ order_id: 'nope', status: 'preparing' }, { order_id: o.order_id, status: 'placed' }, { order_id: o.order_id, status: 'teleported' }, { order_id: o.order_id, status: 'preparing', extra: 1 }, {}, { order_id: o.order_id, status: 'cancelled', reason: 'x'.repeat(500) }]) {
      expect((await call(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const [row] = await db.admin<{ status: string }>(`select status from public.orders where id = $1`, [o.order_id]);
    expect(row!.status).toBe('placed');
  });
  it('an expired session (database says JWT expired) is a 401, not a 500', async () => {
    const o = await newOrder();
    as(w.A.waiter);
    const orig = authState.userId;
    // getUser still passes, but the token the database sees has expired
    const spy = vi.spyOn((await import('./helpers')).fakeUserClient, 'rpc').mockResolvedValueOnce({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } } as never);
    expect((await call({ order_id: o.order_id, status: 'preparing' })).status).toBe(401);
    spy.mockRestore();
    authState.userId = orig;
  });
});

describe('POST /api/staff/request-done', () => {
  const call = (b: unknown) => post(donePOST, '/api/staff/request-done', b);
  it('resolves a waiter call (idempotent); kitchen and other restaurants cannot', async () => {
    const o = await newOrder();
    await db.as('service_role', null, `select public.guest_create_request($1,'waiter','water')`, [o.session_id]);
    const [rq] = await db.admin<{ id: string }>(`select id from public.service_requests where session_id = $1`, [o.session_id]);
    as(w.A.kitchen);
    expect((await call({ request_id: rq!.id })).status).toBe(403);
    as(w.B.waiter);
    expect((await call({ request_id: rq!.id })).status).toBe(404);
    as(w.A.waiter);
    expect((await call({ request_id: rq!.id })).status).toBe(200);
    expect((await call({ request_id: rq!.id })).status).toBe(200); // double tap
    expect((await call({ request_id: 'bad' })).status).toBe(400);
    expect((await call({ request_id: rq!.id, extra: 1 })).status).toBe(400);
    as(null);
    expect((await call({ request_id: rq!.id })).status).toBe(401);
  });
});

describe('POST /api/staff/close-session (mark paid)', () => {
  const call = (b: unknown, o = {}) => post(closePOST, '/api/staff/close-session', b, o);
  const serve = async (id: string) => {
    for (const s of ['preparing', 'ready', 'served']) await db.as('authenticated', w.A.waiter, `select public.staff_set_order_status($1,$2)`, [id, s]);
  };

  it('is blocked while orders are unserved (409), then works and records the payment mode', async () => {
    const o = await newOrder();
    as(w.A.waiter);
    const blocked = await call({ session_id: o.session_id });
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).error.key).toBe('unserved_orders');
    await serve(o.order_id);
    const ok = await call({ session_id: o.session_id, pay_mode: 'upi' });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ already_closed: false, total_paise: 3000 });
    const [s] = await db.admin<{ pay_mode: string; close_reason: string }>(`select pay_mode, close_reason from public.table_sessions where id = $1`, [o.session_id]);
    expect(s).toEqual({ pay_mode: 'upi', close_reason: 'paid' });
    expect((await json(await call({ session_id: o.session_id }))).already_closed).toBe(true); // double tap
  });
  it('waiters and the kitchen cannot force; managers need a reason', async () => {
    const o = await newOrder();
    as(w.A.waiter);
    expect((await call({ session_id: o.session_id, force: true, reason: 'x' })).status).toBe(403);
    as(w.A.kitchen);
    expect((await call({ session_id: o.session_id })).status).toBe(403);
    as(w.A.manager);
    const noReason = await call({ session_id: o.session_id, force: true });
    expect(noReason.status).toBe(400);
    expect((await json(noReason)).error.key).toBe('reason_required');
    expect((await call({ session_id: o.session_id, force: true, reason: 'Guests left' })).status).toBe(200);
  });
  it('other restaurants cannot close it; bad input and bad origin are refused', async () => {
    const o = await newOrder();
    as(w.B.owner);
    expect((await call({ session_id: o.session_id, force: true, reason: 'attack' })).status).toBe(404);
    as(w.A.owner);
    expect((await call({ session_id: 'nope' })).status).toBe(400);
    expect((await call({ session_id: o.session_id, pay_mode: 'bitcoin' })).status).toBe(400);
    expect((await call({ session_id: o.session_id, force: 'yes' })).status).toBe(400);
    expect((await call({ session_id: o.session_id }, { origin: 'https://evil.example' })).status).toBe(403);
    const [s] = await db.admin<{ closed_at: string | null }>(`select closed_at from public.table_sessions where id = $1`, [o.session_id]);
    expect(s!.closed_at).toBeNull();
  });
});

describe('POST /api/staff/availability (sold-out toggle)', () => {
  const call = (b: unknown, o = {}) => post(availPOST, '/api/staff/availability', b, o);
  it('every role can mark a dish sold out and back; guests are blocked immediately', async () => {
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter, w.A.kitchen]) {
      as(uid);
      expect(await json(await call({ item_ids: [w.A.chai], available: false }))).toEqual({ changed: 1 });
      const [t] = await db.admin<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning qr_token`, [w.A.rid, `Z${randomUUID().slice(0, 5)}`]);
      const guest = await orderPOST(req('/api/guest/order', { slug: w.A.slug, token: t!.qr_token, idempotency_key: randomUUID(), items: [{ item_id: w.A.chai, qty: 1 }] }, { ip: uniqueIp() }));
      expect(guest.status).toBe(409);
      expect((await json(guest)).error.key).toBe('item_unavailable');
      expect(await json(await call({ item_ids: [w.A.chai], available: true }))).toEqual({ changed: 1 });
    }
  });
  it('refuses foreign dishes (404), empty/oversized lists and bad shapes (400), and anonymous callers (401)', async () => {
    as(w.A.kitchen);
    expect((await call({ item_ids: [w.B.chai], available: false })).status).toBe(404);
    expect((await call({ item_ids: [w.A.chai, w.B.chai], available: false })).status).toBe(404);
    expect((await call({ item_ids: [], available: false })).status).toBe(400);
    expect((await call({ item_ids: ['x'], available: false })).status).toBe(400);
    expect((await call({ item_ids: [w.A.chai] })).status).toBe(400);
    expect((await call({ item_ids: Array.from({ length: 301 }, () => randomUUID()), available: false })).status).toBe(400);
    const [i] = await db.admin<{ is_available: boolean }>(`select is_available from public.items where id = $1`, [w.A.chai]);
    expect(i!.is_available).toBe(true);
    as(null);
    expect((await call({ item_ids: [w.A.chai], available: false })).status).toBe(401);
  });
});

describe('POST /api/auth/login', () => {
  const PASSWORD = 'correct-horse-battery-staple';
  const emailOf = async (uid: string) => (await db.admin<{ email: string }>(`select email from auth.users where id = $1`, [uid]))[0]!.email;
  const call = (body: unknown, o = {}) => post(loginPOST, '/api/auth/login', body, { ip: uniqueIp(), ...o });

  it('signs a staff member in and sends them to the staff screen', async () => {
    const r = await call({ email: await emailOf(w.A.waiter), password: PASSWORD });
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ ok: true, next: '/staff' });
    expect(authState.userId).toBe(w.A.waiter);
  });
  it('staff of a Padharosaa hotel land on the hotel desk by default; an explicit next still wins', async () => {
    await db.admin(`insert into public.hotel_settings (restaurant_id) values ($1) on conflict do nothing`, [w.A.rid]);
    try {
      expect((await json(await call({ email: await emailOf(w.A.kitchen), password: PASSWORD }))).next).toBe('/padharosaa/desk');
      expect((await json(await call({ email: await emailOf(w.A.owner), password: PASSWORD, next: '/padharosaa/manage' }))).next).toBe('/padharosaa/manage');
      expect((await json(await call({ email: await emailOf(w.A.owner), password: PASSWORD, next: '/staff' }))).next).toBe('/staff');
      expect((await json(await call({ email: await emailOf(w.B.waiter), password: PASSWORD }))).next).toBe('/staff'); // a Menu Lite cafe is unchanged
    } finally {
      await db.admin(`delete from public.hotel_settings where restaurant_id = $1`, [w.A.rid]);
    }
  });
  it('on padharosaa.* a sign-in with no next lands on the hotel desk, on the menu host it still goes to the menu screen', async () => {
    const email = await emailOf(w.A.waiter);
    const pad = await call({ email, password: PASSWORD }, { host: 'padharosaa.taprizz.in' });
    expect(pad.status).toBe(200);
    expect((await json(pad)).next).toBe('/padharosaa/desk');
    expect((await json(await call({ email, password: PASSWORD }, { host: 'menu.taprizz.in' }))).next).toBe('/staff');
  });
  it('wrong password, unknown email and a non-staff account all give the SAME answer (no account enumeration)', async () => {
    const wrongPw = await call({ email: await emailOf(w.A.owner), password: 'nope' });
    const unknown = await call({ email: 'nobody@nowhere.test', password: 'whatever' });
    const nonStaff = await call({ email: await emailOf(w.stranger), password: PASSWORD });
    for (const r of [wrongPw, unknown, nonStaff]) expect(r.status).toBe(401);
    const bodies = await Promise.all([wrongPw, unknown, nonStaff].map(async (r) => { const b = await json(r); return JSON.stringify({ error: b.error }); }));
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('invalid_credentials');
    // the valid-but-not-staff session was ended again
    expect(authState.signOuts.length).toBeGreaterThan(0);
    expect(authState.userId).toBeNull();
  });
  it('only same-site staff areas are valid destinations (no open redirect)', async () => {
    const email = await emailOf(w.A.owner);
    for (const [next, expected] of [['https://evil.example', '/staff'], ['//evil.example', '/staff'], ['/\\evil', '/staff'], ['javascript:alert(1)', '/staff'], ['/guest', '/staff'], ['/admin', '/admin'], ['/dash/menu', '/dash/menu']] as const) {
      const r = await call({ email, password: PASSWORD, next });
      expect((await json(r)).next, next).toBe(expected);
    }
  });
  it('successful sign-ins are never throttled (a restaurant\'s staff share one wifi address)', async () => {
    const ip = uniqueIp();
    const email = await emailOf(w.A.manager);
    for (let i = 0; i < 25; i++) {
      authState.userId = null;
      expect((await call({ email, password: PASSWORD }, { ip })).status, `sign-in ${i}`).toBe(200);
    }
  });
  it('throttles repeated FAILED attempts on one account (8 per 15 minutes) and one address (20 per 10 minutes)', async () => {
    const email = await emailOf(w.B.kitchen);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await call({ email, password: 'wrong' })).status;
    expect(last).toBe(429);
    // even the right password is refused while throttled
    expect((await call({ email, password: PASSWORD })).status).toBe(429);
    const ip = uniqueIp();
    let lastIp = 0;
    for (let i = 0; i < 22; i++) lastIp = (await call({ email: `u${i}@x.test`, password: 'wrong' }, { ip })).status;
    expect(lastIp).toBe(429);
  });
  it('validates input, origin and content type', async () => {
    expect((await call({ email: 'not-an-email', password: 'x' })).status).toBe(400);
    expect((await call({ email: 'a@b.test' })).status).toBe(400);
    expect((await call({ email: 'a@b.test', password: 'x', admin: true })).status).toBe(400);
    expect((await call({ email: 'a@b.test', password: 'x' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call({ email: 'a@b.test', password: 'x' }, { contentType: 'text/plain' })).status).toBe(415);
  });
  it('never echoes the password or database details', async () => {
    const r = await call({ email: 'nobody@nowhere.test', password: 'super-secret-pw-123' });
    const text = JSON.stringify(await json(r));
    expect(text).not.toContain('super-secret-pw-123');
    expect(text).not.toMatch(/auth\.users|select |GM0/i);
  });
});

describe('POST /api/auth/logout', () => {
  it('signs out this device (local) or every device (global)', async () => {
    as(w.A.owner);
    expect((await post(logoutPOST, '/api/auth/logout', {})).status).toBe(200);
    as(w.A.owner);
    expect((await post(logoutPOST, '/api/auth/logout', { scope: 'global' })).status).toBe(200);
    expect(authState.signOuts).toEqual(['local', 'global']);
  });
  it('refuses unknown scopes, foreign origins and extra fields', async () => {
    expect((await post(logoutPOST, '/api/auth/logout', { scope: 'others' })).status).toBe(400);
    expect((await post(logoutPOST, '/api/auth/logout', { scope: 'local', x: 1 })).status).toBe(400);
    expect((await post(logoutPOST, '/api/auth/logout', {}, { origin: 'https://evil.example' })).status).toBe(403);
  });
});

void APP;

describe('guest problems on the staff board', () => {
  const call = (b: unknown) => post(helpDonePOST, '/api/staff/help-done', b);
  const makeHelp = async (t: 'A' | 'B' = 'A') => {
    const [h] = await db.admin<{ id: string }>(`insert into public.help_requests (restaurant_id, room, topics, note) values ($1, '201', '{Towel or bedsheet}', 'Two please') returning id`, [w[t].rid]);
    return h!.id;
  };
  it('the board lists them for reception staff, not for the kitchen, and never across restaurants', async () => {
    const id = await makeHelp();
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter]) {
      as(uid);
      const b = await json(await boardGET(req('/api/staff/board')));
      expect(b.help.find((x: any) => x.id === id)).toMatchObject({ room: '201', topics: ['Towel or bedsheet'], note: 'Two please' });
    }
    as(w.A.kitchen);
    expect((await json(await boardGET(req('/api/staff/board')))).help).toEqual([]);
    as(w.B.waiter);
    expect((await json(await boardGET(req('/api/staff/board')))).help.some((x: any) => x.id === id)).toBe(false);
  });
  it('a waiter marks one done (a double tap is fine); the kitchen, other restaurants and signed-out visitors cannot', async () => {
    const id = await makeHelp();
    as(w.A.kitchen);
    expect((await call({ help_id: id })).status).toBe(403);
    as(w.B.waiter);
    expect((await call({ help_id: id })).status).toBe(404);
    as(w.A.waiter);
    expect((await call({ help_id: id })).status).toBe(200);
    expect((await call({ help_id: id })).status).toBe(200);
    expect((await json(await boardGET(req('/api/staff/board')))).help.some((x: any) => x.id === id)).toBe(false);
    expect((await call({ help_id: 'bad' })).status).toBe(400);
    expect((await call({ help_id: id, extra: 1 })).status).toBe(400);
    as(null);
    expect((await call({ help_id: id })).status).toBe(401);
  });
});
