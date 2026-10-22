import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, type World } from '../../supabase/tests/helpers/fixtures';
import { APP, cookieFrom, req, state, uniqueIp } from './helpers';

vi.mock('@/lib/supabase/admin', async () => {
  const h = await import('./helpers');
  return { adminClient: () => h.fakeAdminClient };
});
import { signGuestCookie, GUEST_COOKIE } from '@/lib/security/cookie';
import { POST as orderPOST } from '@/app/api/guest/order/route';
import { GET as statusGET } from '@/app/api/guest/status/route';
import { POST as requestPOST } from '@/app/api/guest/request/route';
import { POST as eventPOST } from '@/app/api/guest/event/route';
import { POST as roomPOST } from '@/app/api/guest/room/route';
import { POST as tablePOST } from '@/app/api/guest/table/route';
import { POST as helpPOST } from '@/app/api/guest/help/route';
import { GET as healthGET } from '@/app/api/health/route';

let db: TestDb;
let w: World;
const SECRET = process.env.GUEST_COOKIE_SECRET!;

beforeAll(async () => {
  db = await createTestDb();
  state.pool = db.pool;
  w = await buildWorld(db);
});
afterAll(async () => db.close());

async function freshTable() {
  const label = `T${randomUUID().slice(0, 6)}`;
  const [r] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning id, qr_token`, [w.A.rid, label]);
  return { id: r!.id, token: r!.qr_token, label };
}
const orderBody = (t: { token: string }, extra: Record<string, unknown> = {}) => ({
  slug: w.A.slug,
  token: t.token,
  idempotency_key: randomUUID(),
  items: [{ item_id: w.A.chai, qty: 2 }],
  ...extra,
});
const json = async (res: Response) => (await res.json()) as Record<string, any>;

describe('POST /api/guest/order', () => {
  it('places an order, returns the DB-computed total and sets a signed HttpOnly session cookie', async () => {
    const t = await freshTable();
    const res = await orderPOST(req('/api/guest/order', orderBody(t, { note: 'less spicy' }), { ip: uniqueIp() }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const b = await json(res);
    expect(b).toMatchObject({ total_paise: 6000, status: 'placed', replayed: false });
    expect(JSON.stringify(b)).not.toContain(t.token);
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${GUEST_COOKIE}=`))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i); // the site address is https
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Max-Age=43200/);
    expect(setCookie).toMatch(/Path=\//);
  });

  it('refuses price tampering: unknown fields are rejected, and the database total wins anyway', async () => {
    const t = await freshTable();
    for (const bad of [{ total_paise: 1 }, { items: [{ item_id: w.A.paneer, qty: 1, price_paise: 1 }] }]) {
      const res = await orderPOST(req('/api/guest/order', orderBody(t, bad)));
      expect(res.status).toBe(400);
      expect((await json(res)).error.key).toBe('invalid_input');
    }
    const ok = await orderPOST(req('/api/guest/order', orderBody(t, { items: [{ item_id: w.A.paneer, qty: 1 }] })));
    expect((await json(ok)).total_paise).toBe(25000);
  });

  it('rejects a wrong or missing origin (CSRF)', async () => {
    const t = await freshTable();
    for (const o of [{ origin: 'https://evil.example' }, { origin: null }, { origin: null, referer: 'https://evil.example/x' }, { origin: 'http://gotomenu.taprizz.in' }]) {
      const res = await orderPOST(req('/api/guest/order', orderBody(t), o));
      expect(res.status, JSON.stringify(o)).toBe(403);
      expect((await json(res)).error.key).toBe('origin_not_allowed');
    }
    // nothing was created
    const [n] = await db.admin<{ n: number }>(`select count(*)::int n from public.orders where table_id = $1`, [t.id]);
    expect(n!.n).toBe(0);
    // a same-site Referer is accepted when Origin is absent
    const ok = await orderPOST(req('/api/guest/order', orderBody(t), { origin: null, referer: `${APP}/${w.A.slug}` }));
    expect(ok.status).toBe(200);
  });

  it('accepts only application/json', async () => {
    const t = await freshTable();
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null]) {
      const res = await orderPOST(req('/api/guest/order', orderBody(t), { contentType: ct }));
      expect(res.status, String(ct)).toBe(415);
    }
  });

  it('rejects oversized and malformed bodies', async () => {
    const t = await freshTable();
    const big = await orderPOST(req('/api/guest/order', undefined, { method: 'POST', rawBody: JSON.stringify(orderBody(t, { note: 'x'.repeat(20000) })) }));
    expect(big.status).toBe(413);
    const bad = await orderPOST(req('/api/guest/order', undefined, { method: 'POST', rawBody: '{not json' }));
    expect(bad.status).toBe(400);
    const empty = await orderPOST(req('/api/guest/order', undefined, { method: 'POST', rawBody: '' }));
    expect(empty.status).toBe(400);
    const arr = await orderPOST(req('/api/guest/order', [1, 2, 3]));
    expect(arr.status).toBe(400);
  });

  it('rejects other HTTP methods', async () => {
    const res = await orderPOST(req('/api/guest/order', undefined, { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('maps business errors to friendly keys (never database text)', async () => {
    const t = await freshTable();
    const cases: [Record<string, unknown>, number, string][] = [
      [{ token: 'f'.repeat(64) }, 403, 'invalid_table_token'],
      [{ items: [{ item_id: w.A.soldOut, qty: 1 }] }, 409, 'item_unavailable'],
      [{ items: [{ item_id: w.B.paneer, qty: 1 }] }, 409, 'item_not_found'],
      [{ items: [{ item_id: randomUUID(), qty: 1 }] }, 409, 'item_not_found'],
      [{ items: [{ item_id: w.A.chai, qty: 1 }, { item_id: w.A.chai, qty: 1 }] }, 400, 'duplicate_item'],
      [{ items: [{ item_id: w.A.platter, qty: 8 }] }, 422, 'limit_exceeded'],
    ];
    for (const [extra, status, key] of cases) {
      const res = await orderPOST(req('/api/guest/order', orderBody(t, extra)));
      const b = await json(res);
      expect(res.status, key).toBe(status);
      expect(b.error.key).toBe(key);
      expect(JSON.stringify(b)).not.toMatch(/GM0|violates|constraint|select |public\./i);
    }
  });

  it('a token from another restaurant never works on this slug', async () => {
    const tb = (await db.admin<{ qr_token: string }>(`select qr_token from public.dining_tables where restaurant_id = $1 limit 1`, [w.B.rid]))[0]!;
    const res = await orderPOST(req('/api/guest/order', { slug: w.A.slug, token: tb.qr_token, idempotency_key: randomUUID(), items: [{ item_id: w.A.chai, qty: 1 }] }));
    expect(res.status).toBe(403);
  });

  it('replay: the same idempotency key returns the same order, one row only', async () => {
    const t = await freshTable();
    const body = orderBody(t);
    const a = await json(await orderPOST(req('/api/guest/order', body)));
    const b = await json(await orderPOST(req('/api/guest/order', body)));
    expect(b.replayed).toBe(true);
    expect(b.order_no).toBe(a.order_no);
    const [n] = await db.admin<{ n: number }>(`select count(*)::int n from public.orders where table_id = $1`, [t.id]);
    expect(n!.n).toBe(1);
  });

  it('suspended restaurants cannot receive orders', async () => {
    const t = await freshTable();
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    const res = await orderPOST(req('/api/guest/order', orderBody(t)));
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
    expect(res.status).toBe(403);
    expect((await json(res)).error.key).toBe('restaurant_suspended');
  });

  it('throttles repeated WRONG-TOKEN attempts from one IP (token guessing): 20 allowed, then 429', async () => {
    const ip = uniqueIp();
    const t = await freshTable();
    let last = 0;
    for (let i = 0; i < 25; i++) {
      const res = await orderPOST(req('/api/guest/order', orderBody({ token: 'a'.repeat(64) }), { ip }));
      last = res.status;
      if (i < 20) expect(res.status, `attempt ${i}`).toBe(403);
    }
    expect(last).toBe(429);
    // the same address is also blocked from the waiter endpoint (one shared guessing budget)...
    expect((await requestPOST(req('/api/guest/request', { slug: w.A.slug, token: t.token, type: 'waiter', reason: 'water' }, { ip }))).status).toBe(429);
    // ...but another address is unaffected
    expect((await orderPOST(req('/api/guest/order', orderBody(t), { ip: uniqueIp() }))).status).toBe(200);
  });

  it('does NOT throttle honest traffic: 45 successful requests from one shared cafe address all go through', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 45; i++) {
      const t = await freshTable();
      const res = await requestPOST(req('/api/guest/request', { slug: w.A.slug, token: t.token, type: 'waiter', reason: 'water' }, { ip }));
      expect(res.status, `request ${i}`).toBe(200);
    }
  });

  it('other kinds of business errors (e.g. a sold-out dish) do not count towards the guessing limit', async () => {
    const ip = uniqueIp();
    const t = await freshTable();
    for (let i = 0; i < 30; i++) {
      const res = await orderPOST(req('/api/guest/order', orderBody(t, { items: [{ item_id: w.A.soldOut, qty: 1 }] }), { ip }));
      expect(res.status).toBe(409);
    }
  });

  it('turns unexpected database failures into a generic 500 with a request id (no internals leaked)', async () => {
    const t = await freshTable();
    state.forceError = { code: 'XX000', message: 'relation "secret_internal_table" exploded at 10.0.0.5' };
    const res = await orderPOST(req('/api/guest/order', orderBody(t)));
    const text = JSON.stringify(await json(res));
    expect(res.status).toBe(500);
    expect(text).toContain('server_error');
    expect(text).not.toMatch(/secret_internal_table|10\.0\.0\.5|exploded/);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET /api/guest/status', () => {
  const get = (cookie: string | undefined, slug: string | null = w.A.slug) => statusGET(req(`/api/guest/status${slug ? `?slug=${slug}` : ''}`, undefined, { cookie }));

  it('requires the signed cookie: none, forged, expired, wrong restaurant, wrong key', async () => {
    const t = await freshTable();
    const placed = await orderPOST(req('/api/guest/order', orderBody(t)));
    const cookie = cookieFrom(placed)!;
    const sid = (await db.admin<{ session_id: string }>(`select session_id from public.orders where table_id = $1`, [t.id]))[0]!.session_id;
    const now = Math.floor(Date.now() / 1000);

    expect((await get(undefined)).status).toBe(401);
    expect((await get('gm_sid=garbage')).status).toBe(401);
    expect((await get(`gm_sid=${signGuestCookie({ sessionId: sid, slug: w.A.slug, exp: now + 600 }, 'attacker-secret-attacker-secret-attacker')}`)).status).toBe(401);
    expect((await get(`gm_sid=${signGuestCookie({ sessionId: sid, slug: w.A.slug, exp: now - 5 }, SECRET)}`)).status).toBe(401);
    // a valid cookie for restaurant A is useless when asking about restaurant B
    expect((await get(cookie, w.B.slug)).status).toBe(401);
    expect((await get(cookie, null)).status).toBe(401);
    // tampered: flip a character of the signature
    expect((await get(cookie.slice(0, -2) + (cookie.endsWith('A') ? 'B' : 'A') + cookie.slice(-1))).status).toBe(401);
    const ok = await get(cookie);
    expect(ok.status).toBe(200);
  });

  it('returns live orders, running total and requests, and never the QR token', async () => {
    const t = await freshTable();
    const cookie = cookieFrom(await orderPOST(req('/api/guest/order', orderBody(t, { items: [{ item_id: w.A.paneer, qty: 1 }, { item_id: w.A.chai, qty: 2 }] }))))!;
    await requestPOST(req('/api/guest/request', { slug: w.A.slug, token: t.token, type: 'waiter', reason: 'water' }, { cookie }));
    const res = await get(cookie);
    const b = await json(res);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(b.state).toBe('open');
    expect(b.total_paise).toBe(31000);
    expect(b.orders[0].items.length).toBe(2);
    expect(b.requests[0]).toMatchObject({ type: 'waiter', reason: 'water' });
    expect(JSON.stringify(b)).not.toContain(t.token);
    // staff progress is visible
    const oid = (await db.admin<{ id: string }>(`select id from public.orders where table_id = $1`, [t.id]))[0]!.id;
    await db.as('authenticated', w.A.kitchen, `select public.staff_set_order_status($1,'preparing')`, [oid]);
    expect((await json(await get(cookie))).orders[0].status).toBe('preparing');
  });

  it('shows the thank-you state after the table is closed, then expires', async () => {
    const t = await freshTable();
    const cookie = cookieFrom(await orderPOST(req('/api/guest/order', orderBody(t))))!;
    const sid = (await db.admin<{ session_id: string }>(`select session_id from public.orders where table_id = $1`, [t.id]))[0]!.session_id;
    await db.as('authenticated', w.A.owner, `select public.staff_close_session($1, true, 'test')`, [sid]);
    const b = await json(await get(cookie));
    expect(b).toMatchObject({ state: 'closed', total_paise: 6000, review_available: true });
    await db.admin(`update public.table_sessions set opened_at = now() - interval '3 hours', closed_at = now() - interval '45 minutes' where id = $1`, [sid]);
    expect((await json(await get(cookie))).state).toBe('expired');
  });

  it('a closed session can no longer be used to order; a fresh scan starts a new session', async () => {
    const t = await freshTable();
    const first = await orderPOST(req('/api/guest/order', orderBody(t)));
    const oldCookie = cookieFrom(first)!;
    const sid = (await db.admin<{ session_id: string }>(`select session_id from public.orders where table_id = $1`, [t.id]))[0]!.session_id;
    await db.as('authenticated', w.A.owner, `select public.staff_close_session($1, true, 'test')`, [sid]);
    const again = await orderPOST(req('/api/guest/order', orderBody(t), { cookie: oldCookie }));
    expect(again.status).toBe(200);
    const newSid = (await db.admin<{ session_id: string }>(`select session_id from public.orders where table_id = $1 order by created_at desc limit 1`, [t.id]))[0]!.session_id;
    expect(newSid).not.toBe(sid);
  });

  it('is rate limited per session (not per IP): 40 per minute', async () => {
    const t = await freshTable();
    const cookie = cookieFrom(await orderPOST(req('/api/guest/order', orderBody(t))))!;
    let last = 0;
    for (let i = 0; i < 42; i++) last = (await get(cookie)).status;
    expect(last).toBe(429);
    // a different session behind the same IP is unaffected
    const t2 = await freshTable();
    const c2 = cookieFrom(await orderPOST(req('/api/guest/order', orderBody(t2))))!;
    expect((await get(c2)).status).toBe(200);
  });

  it('rejects POST', async () => {
    expect((await statusGET(req('/api/guest/status?slug=x-y', {}))).status).toBe(405);
  });
});

describe('POST /api/guest/request', () => {
  const ask = (body: Record<string, unknown>, o = {}) => requestPOST(req('/api/guest/request', body, o));

  it('calls the waiter before any order, sets the cookie, and is idempotent', async () => {
    const t = await freshTable();
    const a = await ask({ slug: w.A.slug, token: t.token, type: 'waiter', reason: 'water' });
    expect(a.status).toBe(200);
    expect(cookieFrom(a)).toBeTruthy();
    const b = await ask({ slug: w.A.slug, token: t.token, type: 'waiter', reason: 'cutlery' });
    expect((await json(b)).request.reason).toBe('water');
    const [n] = await db.admin<{ n: number }>(`select count(*)::int n from public.service_requests where table_id = $1 and status = 'open'`, [t.id]);
    expect(n!.n).toBe(1);
  });

  it('asks for the bill with each payment mode, and lets the guest change it while open', async () => {
    const t = await freshTable();
    await orderPOST(req('/api/guest/order', orderBody(t)));
    for (const mode of ['cash', 'upi', 'card']) {
      const res = await ask({ slug: w.A.slug, token: t.token, type: 'bill', pay_mode: mode });
      expect((await json(res)).request).toMatchObject({ type: 'bill', pay_mode: mode, status: 'open' });
    }
    const [n] = await db.admin<{ n: number }>(`select count(*)::int n from public.service_requests where table_id = $1 and type = 'bill' and status = 'open'`, [t.id]);
    expect(n!.n).toBe(1);
  });

  it('refuses a bill before anything is ordered', async () => {
    const t = await freshTable();
    const res = await ask({ slug: w.A.slug, token: t.token, type: 'bill', pay_mode: 'cash' });
    expect(res.status).toBe(409);
    expect((await json(res)).error.key).toBe('no_orders');
  });

  it('validates input, origin, content type and tokens', async () => {
    const t = await freshTable();
    expect((await ask({ slug: w.A.slug, token: t.token, type: 'waiter', reason: 'dance' })).status).toBe(400);
    expect((await ask({ slug: w.A.slug, token: t.token, type: 'bill', pay_mode: 'bitcoin' })).status).toBe(400);
    expect((await ask({ slug: w.A.slug, token: t.token, type: 'bill', reason: 'water' })).status).toBe(400);
    expect((await ask({ slug: w.A.slug, token: t.token, type: 'waiter', reason: 'water' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await ask({ slug: w.A.slug, token: t.token, type: 'waiter', reason: 'water' }, { contentType: 'text/plain' })).status).toBe(415);
    expect((await ask({ slug: w.A.slug, token: 'e'.repeat(64), type: 'waiter', reason: 'water' })).status).toBe(403);
  });

  it('rejects requests for a rotated (old) QR', async () => {
    const t = await freshTable();
    await db.as('authenticated', w.A.owner, `select public.mgr_rotate_table_token($1)`, [t.id]);
    const res = await ask({ slug: w.A.slug, token: t.token, type: 'waiter', reason: 'water' });
    expect(res.status).toBe(403);
    expect((await json(res)).error.key).toBe('invalid_table_token');
  });
});

describe('the old Google-review redirect is gone', () => {
  it('there is no /api/guest/review endpoint any more (the thank-you screen shows the explore button instead)', async () => {
    await expect(import('@/app/api/guest/review/route' as string)).rejects.toThrow();
  });
});

describe('GET /api/health', () => {
  it('reports up/down without internals', async () => {
    const ok = await healthGET();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    state.forceError = { code: 'XX000', message: 'connection to 10.1.2.3 refused' };
    const down = await healthGET();
    expect(down.status).toBe(503);
    expect(JSON.stringify(await down.json())).not.toContain('10.1.2.3');
  });
});

describe('server-only secrets never appear in responses', () => {
  it('responses do not echo the cookie secret or service key', async () => {
    const t = await freshTable();
    const res = await orderPOST(req('/api/guest/order', orderBody(t)));
    const all = JSON.stringify(await json(res)) + [...res.headers.entries()].map(([k, v]) => (k === 'set-cookie' ? '' : v)).join('');
    for (const s of [SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY!, process.env.IP_HASH_SALT!]) expect(all).not.toContain(s);
  });
});

describe('POST /api/guest/event (menu analytics)', () => {
  const visit = randomUUID();
  const send = (body: unknown, o: Record<string, unknown> = {}) => eventPOST(req('/api/guest/event', body, { ip: uniqueIp(), ...o }));
  it('records a valid event and always answers ok without setting any cookie', async () => {
    const res = await send({ slug: w.A.slug, visit, event: 'menu_opened' });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(res.headers.getSetCookie()).toEqual([]);
    const rows = await db.admin<{ event: string }>(`select event from public.menu_events where visit_id = $1`, [visit]);
    expect(rows.map((r) => r.event)).toEqual(['menu_opened']);
    // a refresh (same visit, same event) is accepted but not counted again
    expect((await send({ slug: w.A.slug, visit, event: 'menu_opened' })).status).toBe(200);
    expect(await db.admin(`select 1 from public.menu_events where visit_id = $1`, [visit])).toHaveLength(1);
  });
  it('refuses foreign origins, unknown events, extra fields and malformed ids', async () => {
    expect((await send({ slug: w.A.slug, visit, event: 'menu_opened' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send({ slug: w.A.slug, visit, event: 'drop_table' })).status).toBe(400);
    expect((await send({ slug: w.A.slug, visit, event: 'search', extra: 1 })).status).toBe(400);
    expect((await send({ slug: w.A.slug, visit: 'nope', event: 'search' })).status).toBe(400);
    expect((await send({ slug: 'No Such!', visit, event: 'search' })).status).toBe(400);
  });
  it('an unknown restaurant records nothing and reveals nothing', async () => {
    const v = randomUUID();
    const res = await send({ slug: 'no-such-cafe', visit: v, event: 'menu_opened' });
    expect(res.status).toBe(200);
    expect(await db.admin(`select 1 from public.menu_events where visit_id = $1`, [v])).toHaveLength(0);
  });
});

describe('orders only near the cafe (POST /api/guest/order)', () => {
  const CAFE = { lat: 26.9124, lng: 75.7873 };
  const on = (v: boolean) => db.admin(`update public.restaurants set geo_required = $2, geo_lat = $3, geo_lng = $4, geo_radius_m = 150 where id = $1`, [w.A.rid, v, CAFE.lat, CAFE.lng]);
  it('asks for the position, refuses far or fuzzy positions, accepts a near one, and never stores it', async () => {
    await on(true);
    try {
      const t = await freshTable();
      const post = (extra: Record<string, unknown>) => orderPOST(req('/api/guest/order', orderBody(t, extra), { ip: uniqueIp() }));
      const none = await post({});
      expect(none.status).toBe(403);
      expect((await json(none)).error.key).toBe('location_required');
      const far = await post({ geo: { lat: CAFE.lat + 0.05, lng: CAFE.lng, accuracy: 20 } });
      expect((await json(far)).error.key).toBe('too_far_from_restaurant');
      const fuzzy = await post({ geo: { lat: CAFE.lat, lng: CAFE.lng, accuracy: 800 } });
      expect((await json(fuzzy)).error.key).toBe('location_inaccurate');
      expect(await db.admin(`select 1 from public.orders where session_id in (select id from public.table_sessions where table_id = $1)`, [t.id])).toHaveLength(0);
      const ok = await post({ geo: { lat: CAFE.lat + 0.0004, lng: CAFE.lng, accuracy: 25 } });
      expect(ok.status).toBe(200);
      // the position is not kept anywhere in the order data
      const cols = await db.admin<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name in ('orders','table_sessions','order_items') and column_name ~* '(lat|lng|geo)'`);
      expect(cols).toEqual([]);
      expect((await orderPOST(req('/api/guest/order', { ...orderBody(t), geo: { lat: 200, lng: 0, accuracy: 1 } }, { ip: uniqueIp() }))).status).toBe(400);
    } finally {
      await on(false);
    }
  });
  it('does not ask anything of cafes that did not switch it on', async () => {
    const t = await freshTable();
    expect((await orderPOST(req('/api/guest/order', orderBody(t), { ip: uniqueIp() }))).status).toBe(200);
  });
});

describe('POST /api/guest/room', () => {
  let link: string;
  const open = (room: string, extra: Record<string, unknown> = {}, ip = uniqueIp()) => roomPOST(req('/api/guest/room', { slug: w.A.slug, token: link, room, ...extra }, { ip }));
  beforeAll(async () => {
    link = 'c'.repeat(64);
    await db.admin(`update public.restaurants set room_token = $2, room_numbers = '{101,204}' where id = $1`, [w.A.rid, link]);
  });

  it('turns the shared link and a room number into that room\'s own link, which then orders normally', async () => {
    const res = await open('204');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const b = await json(res);
    expect(b).toMatchObject({ label: 'Room 204' });
    expect(b.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.token).not.toBe(link);
    const ordered = await orderPOST(req('/api/guest/order', orderBody({ token: b.token }), { ip: uniqueIp() }));
    expect(ordered.status).toBe(200);
    // the shared link on its own cannot order
    const direct = await orderPOST(req('/api/guest/order', orderBody({ token: link }), { ip: uniqueIp() }));
    expect(direct.status).toBe(403);
    expect((await json(direct)).error.key).toBe('invalid_table_token');
  });

  it('says so for a room that is not on the list, refuses bad input and wrong links, and never accepts other origins', async () => {
    expect((await json(await open('999'))).error.key).toBe('unknown_room');
    expect((await open('999')).status).toBe(422);
    expect((await open('')).status).toBe(400);
    expect((await open('a;b')).status).toBe(400);
    expect((await open('204', { token: 'd'.repeat(64) })).status).toBe(403);
    expect((await open('204', { extra: 1 })).status).toBe(400);
    const cross = await roomPOST(req('/api/guest/room', { slug: w.A.slug, token: link, room: '204' }, { ip: uniqueIp(), origin: 'https://evil.example' }));
    expect(cross.status).toBe(403);
  });

  it('counts wrong-link attempts against the address like any other token guessing', async () => {
    const ip = uniqueIp();
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await open('204', { token: `${(i + 16).toString(16).padStart(2, '0')}`.repeat(32) }, ip)).status;
    expect(last).toBe(429);
  });
});

describe('POST /api/guest/table', () => {
  let link: string;
  const open = (table: string, extra: Record<string, unknown> = {}, ip = uniqueIp()) => tablePOST(req('/api/guest/table', { slug: w.A.slug, token: link, table, ...extra }, { ip }));
  beforeAll(async () => {
    link = 'b'.repeat(64);
    await db.admin(`update public.restaurants set table_token = $2 where id = $1`, [w.A.rid, link]);
    await db.admin(`insert into public.dining_tables (restaurant_id, label) values ($1, 'LK1') on conflict do nothing`, [w.A.rid]);
  });

  it('turns the shared table link and a table name into that table\'s own link, which then orders normally', async () => {
    const res = await open('lk1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const b = await json(res);
    expect(b).toMatchObject({ label: 'LK1' });
    expect(b.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await orderPOST(req('/api/guest/order', orderBody({ token: b.token }), { ip: uniqueIp() }))).status).toBe(200);
    expect((await orderPOST(req('/api/guest/order', orderBody({ token: link }), { ip: uniqueIp() }))).status).toBe(403);
  });

  it('refuses unknown tables, rooms, bad input, wrong links and other origins', async () => {
    expect((await json(await open('NOPE'))).error.key).toBe('unknown_room');
    expect((await open('NOPE')).status).toBe(422);
    expect((await open('')).status).toBe(400);
    expect((await open('LK1', { token: 'd'.repeat(64) })).status).toBe(403);
    expect((await open('LK1', { extra: 1 })).status).toBe(400);
    expect((await tablePOST(req('/api/guest/table', { slug: w.A.slug, token: link, table: 'LK1' }, { ip: uniqueIp(), origin: 'https://evil.example' }))).status).toBe(403);
  });
});

describe('POST /api/guest/order with sizes and options', () => {
  it('prices the order from the server: size plus extras, never from the request', async () => {
    const t = await freshTable();
    const [dish] = await db.admin<{ id: string }>(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1, $2, 'API Shake', 100) returning id`, [w.A.rid, w.A.catId]);
    const [small, large] = await db.admin<{ id: string }>(`insert into public.item_variants (restaurant_id, item_id, name, price_paise, sort_order) values ($1, $2, 'Small', 12000, 1), ($1, $2, 'Large', 20000, 2) returning id`, [w.A.rid, dish!.id]);
    const [grp] = await db.admin<{ id: string }>(`insert into public.item_option_groups (restaurant_id, item_id, name, required, max_select) values ($1, $2, 'Topping', true, 1) returning id`, [w.A.rid, dish!.id]);
    const [oreo, choco] = await db.admin<{ id: string }>(`insert into public.item_options (restaurant_id, group_id, name, price_delta_paise, sort_order) values ($1, $2, 'Oreo', 0, 1), ($1, $2, 'Choco', 1500, 2) returning id`, [w.A.rid, grp!.id]);
    const line = (extra: Record<string, unknown>) => ({ item_id: dish!.id, qty: 2, ...extra });
    const res = await orderPOST(req('/api/guest/order', orderBody(t, { items: [line({ variant_id: large!.id, option_ids: [choco!.id] })] }), { ip: uniqueIp() }));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ total_paise: 2 * (20000 + 1500), status: 'placed' });
    const [oi] = await db.admin<any>(`select name_en_snapshot n, unit_price_paise p from public.order_items oi join public.orders o on o.id = oi.order_id where o.table_id = $1`, [t.id]);
    expect(oi).toEqual({ n: 'API Shake (Large) + Choco', p: 21500 });

    // missing size / missing required topping / unknown ids / extra fields are all refused with the right status
    expect((await orderPOST(req('/api/guest/order', orderBody(t, { items: [line({ option_ids: [oreo!.id] })] }), { ip: uniqueIp() }))).status).toBe(400);
    expect((await orderPOST(req('/api/guest/order', orderBody(t, { items: [line({ variant_id: small!.id })] }), { ip: uniqueIp() }))).status).toBe(400);
    expect((await orderPOST(req('/api/guest/order', orderBody(t, { items: [line({ variant_id: randomUUID(), option_ids: [oreo!.id] })] }), { ip: uniqueIp() }))).status).toBe(409);
    expect((await orderPOST(req('/api/guest/order', orderBody(t, { items: [line({ variant_id: small!.id, option_ids: ['nope'] })] }), { ip: uniqueIp() }))).status).toBe(400);
    expect((await orderPOST(req('/api/guest/order', orderBody(t, { items: [line({ variant_id: small!.id, option_ids: [oreo!.id], price_paise: 1 })] }), { ip: uniqueIp() }))).status).toBe(400);
    expect((await orderPOST(req('/api/guest/order', orderBody(t, { items: [line({ variant_id: small!.id, option_ids: Array.from({ length: 21 }, () => randomUUID()) })] }), { ip: uniqueIp() }))).status).toBe(400);
    // a plain dish is unchanged
    expect((await orderPOST(req('/api/guest/order', orderBody(await freshTable()), { ip: uniqueIp() }))).status).toBe(200);
  });
});

describe('POST /api/guest/help', () => {
  const link = 'a1'.repeat(32);
  const send = (b: Record<string, unknown>, ip = uniqueIp(), o: Record<string, unknown> = {}) => helpPOST(req('/api/guest/help', { slug: w.A.slug, token: link, room: '201', topics: ['Towel'], ...b }, { ip, ...o }));
  beforeAll(async () => {
    await db.admin(`update public.restaurants set help_token = $2, room_numbers = '{}', help_topics = '{Towel,Wi-Fi down,Light not working}' where id = $1`, [w.A.rid, link]);
  });

  it('sends a problem to reception: room, topics and a note; the same message again is the same request', async () => {
    const res = await send({ room: ' 201 ', topics: ['Towel', 'Wi-Fi down'], note: ' The router is red ' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await json(res)).toEqual({ room: '201', replayed: false });
    const [row] = await db.admin<any>(`select room, topics, note, status from public.help_requests where restaurant_id = $1 and room = '201' order by created_at desc limit 1`, [w.A.rid]);
    expect(row).toEqual({ room: '201', topics: ['Towel', 'Wi-Fi down'], note: 'The router is red', status: 'open' });
    expect(await json(await send({ room: '201', topics: ['Towel', 'Wi-Fi down'], note: 'The router is red' }))).toEqual({ room: '201', replayed: true });
  });

  it('a note alone is fine; nothing at all, unknown problems, bad rooms, long notes, extra fields are refused', async () => {
    expect((await send({ room: '202', topics: [], note: 'The door is stuck' })).status).toBe(200);
    expect((await send({ room: '203', topics: [] })).status).toBe(400);
    expect((await send({ room: '203', topics: ['Nope'] })).status).toBe(400);
    expect((await json(await send({ room: '203', topics: ['Nope'] }))).error.key).toBe('invalid_input');
    expect((await send({ room: '' })).status).toBe(400);
    expect((await send({ room: 'a;b' })).status).toBe(400);
    expect((await send({ room: '203', note: 'n'.repeat(301) })).status).toBe(400);
    expect((await send({ room: '203', topics: Array.from({ length: 13 }, (_, i) => `t${i}`) })).status).toBe(400);
    expect((await send({ room: '203', extra: 1 })).status).toBe(400);
  });

  it('refuses a wrong link, another origin, and counts wrong-link guesses against the address', async () => {
    expect((await send({ token: 'b2'.repeat(32) })).status).toBe(403);
    expect((await json(await send({ token: 'b2'.repeat(32) }))).error.key).toBe('invalid_table_token');
    expect((await send({}, uniqueIp(), { origin: 'https://evil.example' })).status).toBe(403);
    const ip = uniqueIp();
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await send({ token: `${(i + 16).toString(16).padStart(2, '0')}`.repeat(32) }, ip)).status;
    expect(last).toBe(429);
  });
});
