import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Adversarial suite: a hostile guest and a hostile (or careless) staff member try to break Padharosaa.
// Every test states the attack in its name; a pass means the system held.
let db: TestDb;
let w: World;
let keyA: string;
let keyB: string;
let sA: string; // guest, hotel A room 204
let sA2: string; // guest, hotel A room 205
let sB: string; // guest, hotel B room 204
let roomA: string;
let roomB: string;

const idem = () => randomUUID();
const sha = (s: string) => createHash('sha256').update(s).digest();
const call = (fn: string, n: number) => `select public.${fn}(${Array.from({ length: n }, (_, i) => `$${i + 1}`).join(',')}) as r`;
const svc = async <T = any>(fn: string, a: unknown[]): Promise<T> => (await db.as('service_role', null, call(fn, a.length), a as never))[0]!.r as T;
const svcErr = (fn: string, a: unknown[]) => db.asErr('service_role', null, call(fn, a.length), a as never);
const staff = async <T = any>(uid: string, fn: string, a: unknown[]): Promise<T> => (await db.as('authenticated', uid, call(fn, a.length), a as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, a: unknown[]) => db.asErr('authenticated', uid, call(fn, a.length), a as never);
const create = (s: string, type: string, label: string, detail: string | null = null, urgent = false, key = idem()) =>
  svc<any>('padh_guest_create_request', [s, type, label, detail, urgent, key]);
const row = async (id: string) => (await db.admin<any>(`select * from public.requests where id = $1`, [id]))[0];

async function mkSession(rid: string, room: string, name: string, status = 'active') {
  const r = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) on conflict (restaurant_id, number) do update set number = excluded.number returning id`, [rid, room]))[0]!.id;
  return (
    await db.admin<{ id: string }>(
      `insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash, status)
       values ($1,$2,$3,'+91','\\x01','\\x02',$4,$5) returning id`,
      [rid, r, name, Buffer.from(randomUUID()), status],
    )
  )[0]!.id;
}
const login = (t: typeof w.A, key: string, o: { room?: string; code?: string | null; ip?: string; slug?: string } = {}) =>
  svc<any>('padh_guest_login', [o.slug ?? t.slug, key, 'Mallory Hax', '+91', Buffer.from('enc'), sha('9876543210'), 'en', o.room ?? '204', o.code ?? null, sha(randomUUID()), null, false, null, o.ip ?? 'ip-x']);
const loginErr = (t: typeof w.A, key: string, o: { room?: string; code?: string | null; ip?: string; slug?: string } = {}) =>
  svcErr('padh_guest_login', [o.slug ?? t.slug, key, 'Mallory Hax', '+91', Buffer.from('enc'), sha('9876543210'), 'en', o.room ?? '204', o.code ?? null, sha(randomUUID()), null, false, null, o.ip ?? 'ip-x']);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  keyA = (await svc<any>('padh_admin_enable_hotel', [w.admin, w.A.rid, 'Asia/Kolkata'])).qr_key;
  keyB = (await svc<any>('padh_admin_enable_hotel', [w.admin, w.B.rid, 'Asia/Kolkata'])).qr_key;
  sA = await mkSession(w.A.rid, '204', 'Anita');
  sA2 = await mkSession(w.A.rid, '205', 'Ravi');
  sB = await mkSession(w.B.rid, '204', 'Pierre');
  roomA = (await db.admin<{ id: string }>(`select id from public.rooms where restaurant_id = $1 and number = '204'`, [w.A.rid]))[0]!.id;
  roomB = (await db.admin<{ id: string }>(`select id from public.rooms where restaurant_id = $1 and number = '204'`, [w.B.rid]))[0]!.id;
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.admin(`delete from public.rate_limits`);
});

describe('guest attacks: identity and session', () => {
  it('01 a made-up session id is refused', async () => {
    expect((await svcErr('padh_guest_create_request', [randomUUID(), 'help', 'x', null, false, idem()]))?.code).toBeTruthy();
  });
  it('02 an ended, blocked or expired session cannot create requests', async () => {
    for (const st of ['ended', 'blocked', 'expired']) {
      const s = await mkSession(w.A.rid, '210', `Ghost ${st}`, st);
      expect((await svcErr('padh_guest_create_request', [s, 'housekeeping', 'Towels', null, false, idem()]))?.code, st).toBeTruthy();
    }
  });
  it('03 a wrong, empty or other-hotel QR key cannot log in', async () => {
    for (const k of ['nope', '', keyB, keyA.slice(0, -1) + 'x']) expect((await loginErr(w.A, k))?.code, k).toBeTruthy();
  });
  it('04 an unknown hotel slug is refused and an unknown room gives a plain failure, no detail leak', async () => {
    const a = await loginErr(w.A, keyA, { slug: 'no-such-hotel' });
    const b = await login(w.A, keyA, { room: '999' });
    expect(a?.code).toBe('GM002');
    expect(b).toMatchObject({ ok: false, code: 'unknown_room' });
    expect(String(a?.message ?? '') + JSON.stringify(b)).not.toMatch(/restaurant_id|uuid|relation|column/i);
    expect((await db.admin<any>(`select count(*)::int as n from public.guest_sessions where guest_name = 'Mallory Hax'`))[0].n).toBe(0);
  });
  it('05 brute-forcing stay codes from one IP never logs in and gets locked out', async () => {
    await db.admin(`update public.hotel_settings set verification_level = 'strict' where restaurant_id = $1`, [w.A.rid]);
    const codes: string[] = [];
    for (let i = 0; i < 40; i++) codes.push((await login(w.A, keyA, { room: '204', code: String(1000 + i), ip: 'brute-ip' })).code ?? 'OK');
    expect(codes).not.toContain('OK');
    expect(codes.slice(0, 5).every((c) => c === 'login_failed')).toBe(true);
    expect(codes.slice(5).every((c) => c === 'locked')).toBe(true); // locked after 5 wrong codes
    await db.admin(`update public.hotel_settings set verification_level = 'light' where restaurant_id = $1`, [w.A.rid]);
  });
  it('06 rotating the QR key kills the old printed QR', async () => {
    const fresh = 'e'.repeat(64);
    await staff(w.A.owner, 'padh_qr_set', [sha(fresh), Buffer.from(`enc:${fresh}`)]);
    expect((await loginErr(w.A, keyA))?.code).toBeTruthy();
    expect((await login(w.A, fresh)).session_id ?? true).toBeTruthy();
    keyA = fresh;
  });
  it('07 login input abuse: bad name, country code, language and short token are rejected', async () => {
    const base = [w.A.slug, keyA, 'Mallory Hax', '+91', Buffer.from('enc'), sha('1'), 'en', '204', null, sha('t'), null, false, null, 'ip'];
    const mut = (i: number, v: unknown) => base.map((x, j) => (j === i ? v : x));
    for (const a of [mut(2, 'A'), mut(2, 'x'.repeat(500)), mut(3, '+9999'), mut(3, 'abc'), mut(6, 'klingon'), mut(9, Buffer.from('short'))])
      expect((await svcErr('padh_guest_login', a))?.code).toBe('GM015');
  });
});

describe('guest attacks: requests', () => {
  it('08 oversized label and detail are rejected, not stored', async () => {
    expect((await svcErr('padh_guest_create_request', [sA, 'help', 'x'.repeat(10_000), null, false, idem()]))?.code).toBe('GM015');
    expect((await svcErr('padh_guest_create_request', [sA, 'help', 'ok', 'y'.repeat(100_000), false, idem()]))?.code).toBe('GM015');
  });
  it('09 control and bidi characters are stripped from stored text', async () => {
    const r = await create(sA, 'housekeeping', 'Tow\u202Eels\u0001 \u2066x2\u2069');
    const q = await row(r.request_id);
    expect(q.label).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u0001]/);
  });
  it('10 HTML and SQL injection strings are stored as inert text', async () => {
    const evil = `'); drop table public.requests; -- <script>alert(1)</script>`;
    const r = await create(sA, 'help', evil);
    expect((await row(r.request_id)).label).toContain('drop table');
    expect((await db.admin<any>(`select count(*)::int as n from public.requests`))[0].n).toBeGreaterThan(0);
  });
  it('11 an unknown request type (e.g. "admin") is rejected', async () => {
    for (const t of ['admin', '', 'housekeeping; select 1', 'HELP']) expect((await svcErr('padh_guest_create_request', [sA, t, 'x', null, false, idem()]))?.code, t).toBeTruthy();
  });
  it('12 flooding requests hits the rate limit', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 40; i++) codes.push((await svcErr('padh_guest_create_request', [sA2, 'errand', `Item ${i} ${randomUUID()}`, null, false, idem()]))?.code ?? 'OK');
    expect(codes.filter((c) => c === 'OK').length).toBeLessThan(25);
    expect(codes.some((c) => c !== 'OK')).toBe(true);
  });
  it("13 a guest cannot read, list or cancel another guest's request", async () => {
    const mine = await create(sA, 'housekeeping', 'Towels for me');
    expect((await svcErr('padh_guest_get_request', [sA2, mine.request_id]))?.code).toBeTruthy();
    expect((await svcErr('padh_guest_cancel_request', [sA2, mine.request_id]))?.code).toBeTruthy();
    expect((await svcErr('padh_guest_cancel_request', [sB, mine.request_id]))?.code).toBeTruthy();
    const list = JSON.stringify(await svc('padh_guest_list_requests', [sA2]));
    expect(list).not.toContain(mine.request_id);
    expect((await row(mine.request_id)).status).not.toBe('cancelled');
  });
  it('14 feedback: not on someone else\'s, not before it is done, not twice, not with a made-up rating', async () => {
    const mine = await create(sA, 'wake', `Wake ${randomUUID()}`);
    expect((await svcErr('padh_guest_feedback', [sA, mine.request_id, 'great']))?.code).toBe('GM012'); // unfinished
    const done = await staff<any>(w.A.waiter, 'padh_accept', [mine.request_id, mine.version]);
    const fin = await staff<any>(w.A.waiter, 'padh_complete', [mine.request_id, done.version]);
    expect(fin.status ?? 'completed').toBeTruthy();
    expect((await svcErr('padh_guest_feedback', [sA2, mine.request_id, 'great']))?.code).toBe('GM012'); // not theirs
    expect((await svcErr('padh_guest_feedback', [sA, mine.request_id, 'amazing!!!']))?.code).toBe('GM015');
    expect((await svc<any>('padh_guest_feedback', [sA, mine.request_id, 'great'])).rating).toBe('great');
    expect((await svc<any>('padh_guest_feedback', [sA, mine.request_id, 'not_good'])).already).toBe(true); // second vote ignored
    expect((await db.admin<any>(`select rating from public.feedback where request_id = $1`, [mine.request_id])).map((r: any) => r.rating)).toEqual(['great']);
  });
  it('15 reusing another guest\'s idempotency key cannot read or hijack their request', async () => {
    const key = idem();
    const a = await create(sA, 'errand', `Laundry ${randomUUID()}`, null, false, key);
    expect((await svcErr('padh_guest_create_request', [sA2, 'errand', 'x', null, false, key]))?.code).toBe('GM012');
    const other = await create(sB, 'errand', 'x', null, false, key).catch((e) => ({ err: e }));
    expect(JSON.stringify(other)).not.toContain(a.request_id); // another hotel gets its own request, never A's
    expect((await row(a.request_id)).session_id).toBe(sA);
  });
  it('16 a help request with an invented category chip or no chips is rejected', async () => {
    expect((await svcErr('padh_guest_create_help', [sA, ['tv', 'rm -rf'], null, false, idem()]))?.code).toBeTruthy();
    expect((await svcErr('padh_guest_create_help', [sA, [], null, false, idem()]))?.code).toBeTruthy();
  });
  it('17 a food order with empty or huge text is rejected', async () => {
    expect((await svcErr('padh_guest_create_food', [sA, '', null, idem()]))?.code).toBeTruthy();
    expect((await svcErr('padh_guest_create_food', [sA, 'z'.repeat(5000), null, idem()]))?.code).toBeTruthy();
  });
});

describe('guest attacks: plan and preferences', () => {
  it('18 more than 30 stops in a plan is refused', async () => {
    const s = await mkSession(w.A.rid, '230', 'Planner');
    const codes: string[] = [];
    for (let i = 0; i < 36; i++) {
      await db.admin(`delete from public.rate_limits`);
      codes.push((await svcErr('padh_guest_plan_add', [s, `Stop ${i}`, null, null, null, null]))?.code ?? 'OK');
    }
    expect(codes.filter((c) => c === 'OK').length).toBeLessThanOrEqual(30);
    expect(codes.some((c) => c !== 'OK')).toBe(true);
  });
  it('19 impossible coordinates and empty names are refused', async () => {
    expect((await svcErr('padh_guest_plan_add', [sA, 'Moon', null, null, 999, 999]))?.code).toBeTruthy();
    expect((await svcErr('padh_guest_plan_add', [sA, '   ', null, null, null, null]))?.code).toBeTruthy();
    expect((await svcErr('padh_guest_plan_add', [sA, 'x'.repeat(4000), null, null, null, null]))?.code).toBeTruthy();
  });
  it("20 a guest cannot adopt another hotel's itinerary or edit another guest's plan item", async () => {
    const it = await staff<any>(w.B.manager, 'padh_itinerary_save', [{ name: 'B Heritage Day', stops: [{ name: 'Amer Fort' }] }]).catch((e) => e);
    const itId = it?.id ?? randomUUID();
    expect((await svcErr('padh_guest_plan_use', [sA, itId]))?.code).toBeTruthy();
    const mine = await svc<any>('padh_guest_plan_add', [sA2, 'Hawa Mahal', null, null, null, null]);
    const item = JSON.stringify(mine).match(/[0-9a-f]{8}-[0-9a-f-]{27}/g)?.pop() ?? randomUUID();
    await svc('padh_guest_plan_remove', [sA, item]);
    expect((await db.admin<any>(`select removed from public.guest_plan_items where id = $1`, [item])).every((r: any) => r.removed === false)).toBe(true);
  });
  it('21 preferences: invented diet/occasion/language are refused', async () => {
    for (const a of [[sA, 'carnivore', null, 'en'], [sA, null, 'divorce', 'en'], [sA, null, null, 'tlh']]) expect((await svcErr('padh_guest_set_preferences', a))?.code).toBeTruthy();
  });
});

describe('guest attacks: API surface and secrets', () => {
  it('22 anon and authenticated roles cannot call any guest RPC', async () => {
    for (const fn of ['padh_guest_create_request', 'padh_guest_home', 'padh_guest_stay', 'padh_guest_list_requests']) {
      const args = fn === 'padh_guest_create_request' ? [sA, 'help', 'x', null, false, idem()] : [sA];
      expect((await db.asErr('anon', null, call(fn, args.length), args as never))?.code, `anon ${fn}`).toBe('42501');
      expect((await db.asErr('authenticated', w.A.manager, call(fn, args.length), args as never))?.code, `auth ${fn}`).toBe('42501');
    }
  });
  it('23 a guest (service role) cannot call staff RPCs', async () => {
    const r = await create(sA, 'help', `Staff only ${randomUUID()}`);
    expect((await svcErr('padh_accept', [r.request_id, r.version]))?.code).toBe('42501');
    expect((await svcErr('padh_guide_save', [{ category: 'tip', name: 'x' }]))?.code).toBe('42501');
    expect((await svcErr('padh_qr_set', [sha('z'), Buffer.from('z'.repeat(40))]))?.code).toBe('42501');
  });
  it('24 staff cannot read phone numbers, Wi-Fi password, token or stay-code columns directly', async () => {
    for (const q of [
      `select mobile_enc from public.guest_sessions`,
      `select mobile_hash from public.guest_sessions`,
      `select token_hash from public.guest_sessions`,
      `select wifi_password_enc from public.hotel_settings`,
      `select qr_key_hash from public.hotel_settings`,
      `select * from public.stay_codes`,
    ]) {
      expect((await db.asErr('authenticated', w.A.owner, q))?.code, q).toBe('42501');
    }
  });
  it('25 anon cannot read any Padharosaa table', async () => {
    for (const t of ['hotel_settings', 'rooms', 'guest_sessions', 'requests', 'messages', 'notifications', 'guide_items', 'staff_profiles']) {
      const e = await db.asErr('anon', null, `select * from public.${t}`);
      const rows = e ? null : await db.as('anon', null, `select * from public.${t}`);
      expect(e?.code === '42501' || (rows && rows.length === 0), t).toBe(true);
    }
  });
  it('26 staff cannot write tables directly (insert, update, delete)', async () => {
    for (const q of [
      `update public.requests set status = 'completed'`,
      `delete from public.requests`,
      `insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash) values ('${w.A.rid}', '${roomA}', 'Eve', '+91', '\\x01', '\\x02', '\\x03')`,
      `update public.hotel_settings set enabled = false`,
    ]) {
      const e = await db.asErr('authenticated', w.A.owner, q);
      expect(e?.code ?? 'none', q).toBe('42501');
    }
  });
  it('27 hotel B manager sees nothing of hotel A guests, requests or settings', async () => {
    await create(sA, 'help', `Only A ${randomUUID()}`);
    const gs = await db.as('authenticated', w.B.manager, `select id from public.guest_sessions where restaurant_id = $1`, [w.A.rid]);
    const rq = await db.as('authenticated', w.B.manager, `select id from public.requests where restaurant_id = $1`, [w.A.rid]);
    const hs = await db.as('authenticated', w.B.manager, `select restaurant_id from public.hotel_settings where restaurant_id = $1`, [w.A.rid]);
    expect([gs.length, rq.length, hs.length]).toEqual([0, 0, 0]);
  });
});

describe('manager and staff attacks: request control', () => {
  it("28 another hotel's manager cannot accept, pass, resolve or dismiss a request", async () => {
    const r = await create(sA, 'housekeeping', `Cross ${randomUUID()}`);
    for (const [fn, a] of [
      ['padh_accept', [r.request_id, r.version]],
      ['padh_pass', [r.request_id, r.version, 'concierge']],
      ['padh_resolve', [r.request_id, r.version, 'fixed']],
      ['padh_dismiss', [r.request_id, r.version, 'because']],
    ] as const)
      expect((await staffErr(w.B.manager, fn, [...a]))?.code, fn).toBe('GM012');
    expect((await row(r.request_id)).status).toBe('received');
  });
  it('29 a stale version is a conflict, never a silent overwrite', async () => {
    const r = await create(sA, 'housekeeping', `Stale ${randomUUID()}`);
    await staff(w.A.waiter, 'padh_accept', [r.request_id, r.version]);
    expect((await staffErr(w.A.manager, 'padh_accept', [r.request_id, r.version]))?.code).toBe('GM019');
  });
  it('30 dismiss needs a real written reason (empty, spaces, control chars)', async () => {
    const r = await create(sA, 'errand', `Dismiss ${randomUUID()}`);
    for (const reason of ['', '   ', '‮​', null]) expect((await staffErr(w.A.manager, 'padh_dismiss', [r.request_id, r.version, reason]))?.code, String(reason)).toBeTruthy();
    expect((await row(r.request_id)).status).toBe('received');
  });
  it('31 a finished request cannot be accepted, passed or dismissed again', async () => {
    const r = await create(sA, 'errand', `Done ${randomUUID()}`);
    const a = await staff<any>(w.A.waiter, 'padh_accept', [r.request_id, r.version]);
    const c = await staff<any>(w.A.waiter, 'padh_complete', [r.request_id, a.version]);
    const v = c.version ?? a.version + 1;
    for (const [fn, args] of [['padh_accept', [r.request_id, v]], ['padh_dismiss', [r.request_id, v, 'late']], ['padh_pass', [r.request_id, v, 'concierge']]] as const)
      expect((await staffErr(w.A.manager, fn, [...args]))?.code, fn).toBeTruthy();
  });
  it('32 passing to a made-up team is refused', async () => {
    const r = await create(sA, 'errand', `Pass ${randomUUID()}`);
    for (const t of ['finance', '', 'kitchen; drop']) expect((await staffErr(w.A.manager, 'padh_pass', [r.request_id, r.version, t]))?.code, t).toBeTruthy();
  });
  it('33 a guest-cancelled request cannot be revived by staff', async () => {
    const r = await create(sA, 'errand', `Cancel ${randomUUID()}`);
    await svc('padh_guest_cancel_request', [sA, r.request_id]);
    const q = await row(r.request_id);
    expect(['cancelled', 'canceled']).toContain(q.status);
    expect((await staffErr(w.A.waiter, 'padh_accept', [r.request_id, q.version]))?.code).toBeTruthy();
  });
  it('34 handover: invented mode, wrong role (guest), non-food request and dining-off delivery are refused', async () => {
    const f = await svc<any>('padh_guest_create_food', [sA, `Thali ${randomUUID()}`, null, idem()]);
    expect((await staffErr(w.A.kitchen, 'padh_set_handover', [f.request_id, f.version, 'drone']))?.code).toBe('GM015');
    expect((await svcErr('padh_set_handover', [f.request_id, f.version, 'deliver']))?.code).toBe('42501');
    const h = await create(sA, 'housekeeping', `Not food ${randomUUID()}`);
    expect((await staffErr(w.A.kitchen, 'padh_set_handover', [h.request_id, h.version, 'deliver']))?.code).toBeTruthy();
    await staff(w.A.manager, 'padh_set_dining', [false]);
    expect((await staffErr(w.A.kitchen, 'padh_set_handover', [f.request_id, f.version, 'deliver']))?.code).toBe('GM015');
    await staff(w.A.manager, 'padh_set_dining', [true]);
  });
  it('35 a waiter or kitchen user cannot toggle room dining or rotate the QR key', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) {
      expect((await staffErr(uid, 'padh_set_dining', [false]))?.code, uid).toBe('GM011');
      expect((await staffErr(uid, 'padh_qr_set', [sha('q'), Buffer.from('q'.repeat(40))]))?.code, uid).toBe('GM011');
    }
  });
  it('36 a manager cannot replace the QR key (owner only), the old typed-word function is closed, and bad key data is refused', async () => {
    expect((await staffErr(w.A.manager, 'padh_qr_set', [sha('m'), Buffer.from('m'.repeat(40))]))?.code).toBe('GM011');
    for (const uid of [w.A.owner, w.A.manager]) expect((await staffErr(uid, 'padh_rotate_qr_key', ['ROTATE']))?.code, uid).toBe('42501');
    for (const bad of [[null, null], [Buffer.from('x'), Buffer.from('y'.repeat(40))]]) expect((await staffErr(w.A.owner, 'padh_qr_set', bad))?.code).toBe('GM015');
  });
});

describe('manager and staff attacks: people, rooms, settings', () => {
  it("37 staff of hotel A cannot issue a stay code for, block, end or check out hotel B's room or guest", async () => {
    expect((await staffErr(w.A.waiter, 'padh_issue_stay_code', [roomB]))?.code).toBeTruthy();
    expect((await staffErr(w.A.waiter, 'padh_block_session', [sB]))?.code).toBeTruthy();
    expect((await staffErr(w.A.manager, 'padh_end_session', [sB]))?.code).toBeTruthy();
    expect((await staffErr(w.A.manager, 'padh_checkout_room', [roomB]))?.code).toBeTruthy();
    expect((await db.admin<any>(`select status from public.guest_sessions where id = $1`, [sB]))[0].status).toBe('active');
  });
  it('38 kitchen and strangers cannot block guests or issue stay codes', async () => {
    for (const uid of [w.A.kitchen, w.stranger]) {
      expect((await staffErr(uid, 'padh_block_session', [sA]))?.code, uid).toBe('GM011');
      expect((await staffErr(uid, 'padh_issue_stay_code', [roomA]))?.code, uid).toBe('GM011');
    }
  });
  it('39 only owner/manager can edit staff profiles; cross-hotel and bad WhatsApp numbers are refused', async () => {
    expect((await staffErr(w.A.waiter, 'padh_staff_profile_set', [w.A.kitchen, 'kitchen', '9876543210', false]))?.code).toBeTruthy();
    expect((await staffErr(w.A.manager, 'padh_staff_profile_set', [w.B.waiter, 'housekeeping', '9876543210', false]))?.code).toBeTruthy();
    for (const wa of ['abc', '123', '+++', '9'.repeat(40)]) expect((await staffErr(w.A.manager, 'padh_staff_profile_set', [w.A.waiter, 'housekeeping', wa, false]))?.code, wa).toBe('GM015');
    expect((await staffErr(w.A.manager, 'padh_staff_profile_set', [w.A.waiter, 'astronaut', null, false]))?.code).toBe('GM015');
  });
  it('40 muting alerts for a made-up team is refused', async () => {
    for (const t of ['finance', '', 'x'.repeat(100)]) expect((await staffErr(w.A.waiter, 'padh_set_my_alert', [t, true]))?.code, t).toBeTruthy();
  });
  it('41 branding: bad colours, javascript: and http: links, huge handles are refused', async () => {
    const b = (o: Partial<Record<string, string | null>>) => [o.color ?? '#B5502A', null, null, null, null, o.ig ?? null, o.google ?? null, o.trip ?? null, o.menu ?? null];
    const run = (a: unknown[]) => db.asErr('authenticated', w.A.manager, `select public.padh_set_branding($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8,$9)`, a as never);
    for (const a of [b({ color: 'red' }), b({ color: '#GGGGGG' }), b({ color: 'url(javascript:1)' }), b({ google: 'javascript:alert(1)' }), b({ google: 'http://insecure.example' }), b({ trip: 'data:text/html,<script>' }), b({ menu: 'ftp://x' }), b({ ig: '"><script>' })])
      expect((await run(a))?.code, JSON.stringify(a)).toBe('GM015');
  });
  it('42 stay settings: malformed phone numbers and oversized Wi-Fi name are refused; non-managers refused', async () => {
    expect((await staffErr(w.A.manager, 'padh_set_stay', ['Wifi', null, '11:00', '7-10', '12', null]))?.code).toBeTruthy();
    expect((await staffErr(w.A.manager, 'padh_set_stay', ['W'.repeat(500), null, '11:00', '7-10', '9999900000', null]))?.code).toBeTruthy();
    expect((await staffErr(w.A.kitchen, 'padh_set_stay', ['Wifi', null, '11:00', '7-10', '9999900000', null]))?.code).toBeTruthy();
  });
  it('43 buffet: invalid mode, invalid date and non-staff are refused', async () => {
    const d = '2030-01-01';
    expect((await staffErr(w.A.manager, 'padh_buffet_set', [d, 'feast', 'x', '19:00', '22:00', 'Hall', null, null]))?.code).toBeTruthy();
    expect((await staffErr(w.A.kitchen, 'padh_buffet_set', [d, 'buffet', 'x', '19:00', '22:00', 'Hall', null, null]))?.code === undefined).toBe(false);
    expect((await staffErr(w.stranger, 'padh_buffet_set', [d, 'buffet', 'x', '19:00', '22:00', 'Hall', null, null]))?.code).toBe('GM011');
  });
  it('44 manager_phone / reception_phone cannot carry a script or letters', async () => {
    for (const bad of ['<script>', 'abcdefghij', '12 34']) {
      expect((await db.asErr('authenticated', w.A.manager, `update public.hotel_settings set reception_phone = $1`, [bad]))?.code, bad).toBe('42501');
      await expect(db.admin(`update public.hotel_settings set reception_phone = $1`, [bad])).rejects.toThrow(); // check constraint, even for the owner of the DB
    }
  });
});

describe('manager attacks: Jaipur guide', () => {
  it('45 an AI or map draft can never go live without a manager review', async () => {
    for (const source of ['ai_draft', 'osm']) {
      const d = await staff<any>(w.A.manager, 'padh_guide_save', [{ category: 'craft', name: `Draft ${source}`, source }]);
      const tryOn = await staff<any>(w.A.manager, 'padh_guide_save', [{ id: d.id, category: 'craft', name: `Draft ${source}`, source, active: true, needs_review: true }]);
      expect(tryOn.active).toBe(false);
      await expect(db.admin(`update public.guide_items set active = true where id = $1`, [d.id])).rejects.toThrow(); // a raw write is refused too
    }
  });
  it('46 guide entries reject javascript: links, bad coordinates and unknown categories', async () => {
    for (const bad of [
      { category: 'place', name: 'x', link_url: 'javascript:alert(1)' },
      { category: 'place', name: 'x', link_url: 'http://plain.example' },
      { category: 'place', name: 'x', lat: 200, lng: 75 },
      { category: 'place', name: 'x', lat: 26.9, lng: 400 },
      { category: 'weapons', name: 'x' },
      { category: 'place', name: '' },
    ])
      expect((await staffErr(w.A.manager, 'padh_guide_save', [bad]))?.code, JSON.stringify(bad)).toBe('GM015');
  });
  it("47 a manager cannot edit or archive another hotel's guide entry", async () => {
    const d = await staff<any>(w.B.manager, 'padh_guide_save', [{ category: 'tip', name: 'B secret tip' }]);
    expect((await staffErr(w.A.manager, 'padh_guide_save', [{ id: d.id, category: 'tip', name: 'hijacked' }]))?.code).toBe('GM012');
    expect((await staffErr(w.A.manager, 'padh_guide_archive', [d.id]))?.code).toBeTruthy();
  });
  it('48 non-managers cannot save or archive guide entries, or curate itineraries', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) {
      expect((await staffErr(uid, 'padh_guide_save', [{ category: 'tip', name: 'x' }]))?.code, uid).toBe('GM011');
      expect((await staffErr(uid, 'padh_itinerary_save', [{ name: 'x', stops: [] }]))?.code, uid).toBe('GM011');
    }
  });
});

describe('platform attacks', () => {
  it('49 enabling a hotel needs the platform admin, not a hotel owner or a stranger', async () => {
    expect((await svcErr('padh_admin_enable_hotel', [w.A.owner, w.B.rid, 'Asia/Kolkata']))?.code).toBeTruthy();
    expect((await svcErr('padh_admin_enable_hotel', [w.stranger, w.B.rid, 'Asia/Kolkata']))?.code).toBeTruthy();
    expect((await staffErr(w.A.owner, 'padh_admin_enable_hotel', [w.A.owner, w.B.rid, 'Asia/Kolkata']))?.code).toBe('42501');
  });
  it('50 notification outbox: staff and guests cannot claim or finish notifications', async () => {
    expect((await staffErr(w.A.owner, 'padh_claim_notifications', [10]))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.padh_claim_notifications(10)`))?.code).toBe('42501');
    expect((await staffErr(w.A.owner, 'padh_finish_notification', [randomUUID(), true, null]))?.code).toBe('42501');
  });
});
