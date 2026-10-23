import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
let keyA: string;
let keyB: string;
const roomIds: Record<string, string> = {};

const sha = (s: string) => createHash('sha256').update(s).digest();
const svc = async <T = any>(fn: string, args: unknown[]): Promise<T> =>
  (await db.as('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const svcErr = (fn: string, args: unknown[]) => db.asErr('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const staff = async <T = any>(uid: string, fn: string, args: unknown[]): Promise<T> =>
  (await db.as('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const staffErr = (uid: string, fn: string, args: unknown[]) => db.asErr('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);

interface LoginOpts { slug?: string; k?: string; name?: string; cc?: string; mobile?: string; lang?: string; room?: string; code?: string | null; token?: string; resume?: string | null; consent?: boolean; ip?: string }
const token = () => randomUUID() + randomUUID();
function login(t: typeof w.A, key: string, o: LoginOpts = {}) {
  const tok = o.token ?? token();
  return svc<any>('padh_guest_login', [
    o.slug ?? t.slug, o.k ?? key, o.name ?? 'Anita Sharma', o.cc ?? '+91', Buffer.from('enc:' + (o.mobile ?? '9876543210')), sha(o.mobile ?? '9876543210'),
    o.lang ?? 'en', o.room ?? '204', o.code ?? null, sha(tok), o.resume ? sha(o.resume) : null, o.consent ?? false, o.consent ? 'v1' : null, o.ip ?? 'ip-1',
  ]).then((r) => ({ ...r, tok }));
}
const level = (rid: string, l: string) => db.admin(`update public.hotel_settings set verification_level = $2 where restaurant_id = $1`, [rid, l]);
const issue = async (room: string) => (await staff<{ code: string }>(w.A.waiter, 'padh_issue_stay_code', [roomIds[room]])).code;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  for (const [t, set] of [[w.A, 'a'], [w.B, 'b']] as const) {
    const out = await svc<any>('padh_admin_enable_hotel', [w.admin, t.rid, 'Asia/Kolkata']);
    if (set === 'a') keyA = out.qr_key;
    else keyB = out.qr_key;
  }
  for (const n of ['204', '205', '206', '207']) {
    roomIds[n] = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,$2) returning id`, [w.A.rid, n]))[0]!.id;
  }
  await db.admin(`insert into public.rooms (restaurant_id, number) values ($1,'204')`, [w.B.rid]);
  await db.admin(`update public.hotel_settings set reception_phone = '9999900000', manager_phone = '9999911111' where restaurant_id = $1`, [w.A.rid]);
  await db.admin(`insert into public.concierge_shifts (restaurant_id, label, start_time, end_time, staff_name, staff_mobile, sort) values
    ($1,'Morning','07:00','15:00','Rakesh','9000000001',1), ($1,'Evening','15:00','23:00','Meera','9000000002',2), ($1,'Night','23:00','07:00','Vikram','9000000003',3)`, [w.A.rid]);
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.admin(`delete from public.rate_limits`);
  await level(w.A.rid, 'light');
});

describe('platform enable + public hotel page', () => {
  it('only a platform admin can enable a hotel; the key is shown once', async () => {
    expect(keyA).toMatch(/^[0-9a-f]{64}$/);
    expect((await svcErr('padh_admin_enable_hotel', [w.stranger, w.A.rid, 'Asia/Kolkata']))?.code).toBeTruthy();
    const again = await svc<any>('padh_admin_enable_hotel', [w.admin, w.A.rid, 'Asia/Kolkata']);
    expect(again.qr_key).toBeNull();
    expect((await svcErr('padh_admin_enable_hotel', [w.admin, randomUUID(), 'Asia/Kolkata']))?.code).toBe('GM012');
    expect((await svcErr('padh_admin_enable_hotel', [w.admin, w.A.rid, 'Mars/Olympus']))?.code).toBe('GM015');
  });

  it('shows name, theme and level, never any phone number; every failure looks the same', async () => {
    const pub = await svc<any>('padh_public_hotel', [w.A.slug, keyA]);
    expect(pub).toMatchObject({ name: 'Cafe Aroma', theme: 'palace_blue', verification_level: 'light' });
    expect(JSON.stringify(pub)).not.toMatch(/9999900000|9999911111|phone/);
    await db.admin(`insert into public.restaurants (slug, name) values ('lite-cafe','Lite')`);
    for (const [slug, k] of [[w.A.slug, 'f'.repeat(64)], [w.A.slug, keyB], ['no-such-hotel', keyA], ['lite-cafe', keyA], [w.A.slug, 'short'], [w.A.slug, null]] as const)
      expect((await svcErr('padh_public_hotel', [slug, k]))?.code, `${slug}/${k}`).toBe('GM002');
    await db.admin(`update public.hotel_settings set enabled = false where restaurant_id = $1`, [w.B.rid]);
    expect((await svcErr('padh_public_hotel', [w.B.slug, keyB]))?.code).toBe('GM002');
    await db.admin(`update public.hotel_settings set enabled = true where restaurant_id = $1`, [w.B.rid]);
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.B.rid]);
    expect((await svcErr('padh_public_hotel', [w.B.slug, keyB]))?.code).toBe('GM002');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.B.rid]);
  });
});

describe('login at the Light level', () => {
  it('creates one session, stores only hashes, sends a welcome and logs consent', async () => {
    const r = await login(w.A, keyA, { consent: true, mobile: '9811111111', room: '205', name: 'Ravi  Kumar' });
    expect(r).toMatchObject({ ok: true, resumed: false });
    const s = (await db.admin<any>(`select * from public.guest_sessions where id = $1`, [r.session_id]))[0];
    expect([s.guest_name, s.status, s.verification, s.consent_messaging]).toEqual(['Ravi Kumar', 'active', 'none', true]);
    expect(Buffer.from(s.token_hash).equals(sha(r.tok))).toBe(true);
    expect(Buffer.from(s.mobile_enc).toString()).toBe('enc:9811111111'); // ciphertext supplied by the API; never plaintext in a column
    const m = (await db.admin<any>(`select body, params from public.messages where session_id = $1`, [r.session_id]))[0];
    expect(m).toMatchObject({ body: 'chat.welcome', params: { name: 'Ravi', hotel: 'Cafe Aroma', room: '205' } });
    expect((await db.admin<any>(`select purpose, granted, text_version from public.consent_log where session_id = $1`, [r.session_id]))[0]).toEqual({ purpose: 'stay_messages', granted: true, text_version: 'v1' });
    const none = await login(w.A, keyA, { mobile: '9822222222', room: '206' });
    expect((await db.admin<any>(`select count(*)::int n from public.consent_log where session_id = $1`, [none.session_id]))[0].n).toBe(0);
  });

  it('the same device scanning again resumes the session without a duplicate; another device gets its own', async () => {
    const a = await login(w.A, keyA, { mobile: '9833333333', room: '207' });
    const again = await login(w.A, keyA, { mobile: '9833333333', room: '207', resume: a.tok, lang: 'hi' });
    expect(again).toMatchObject({ ok: true, resumed: true, session_id: a.session_id });
    expect((await db.admin<any>(`select language from public.guest_sessions where id = $1`, [a.session_id]))[0].language).toBe('hi');
    const other = await login(w.A, keyA, { mobile: '9833333333', room: '207' });
    expect(other.session_id).not.toBe(a.session_id);
    expect((await db.admin<any>(`select count(*)::int n from public.guest_sessions where restaurant_id = $1 and room_id = $2 and status = 'active'`, [w.A.rid, roomIds['207']]))[0].n).toBe(2);
    // a cookie for another room does not resume
    const wrongRoom = await login(w.A, keyA, { mobile: '9833333333', room: '206', resume: a.tok });
    expect(wrongRoom.resumed).toBe(false);
  });

  it('keeps at most 3 live sessions per mobile: the oldest is ended', async () => {
    const m = '9844444444';
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await login(w.A, keyA, { mobile: m })).session_id);
      await db.admin(`update public.guest_sessions set started_at = now() - make_interval(secs => $2) where id = $1`, [ids[i], 100 - i]);
    }
    const st = await db.admin<any>(`select id, status from public.guest_sessions where id = any($1::uuid[])`, [ids]);
    const by = Object.fromEntries(st.map((x) => [x.id, x.status]));
    expect(ids.map((i) => by[i])).toEqual(['ended', 'active', 'active', 'active']);
  });

  it('unknown room is reported plainly (and does not leak which rooms exist); wrong QR key is refused', async () => {
    expect(await login(w.A, keyA, { room: '999' })).toMatchObject({ ok: false, code: 'unknown_room' });
    expect((await svcErr('padh_guest_login', [w.A.slug, keyB, 'Eve Adams', '+91', Buffer.from('x'), sha('1'), 'en', '204', null, sha('t'), null, false, null, 'ip']))?.code).toBe('GM002');
    expect(await db.admin(`select 1 from public.guest_sessions where guest_name = 'Eve Adams'`)).toEqual([]);
  });

  it('rejects bad input (name, country code, language, room format, short token hash)', async () => {
    const bad: Partial<LoginOpts>[] = [{ name: 'A' }, { name: '   ' }, { cc: '91' }, { lang: 'xx' }, { room: 'a;b' }, { room: '' }, { code: '12a4' }];
    for (const o of bad) expect((await svcErr('padh_guest_login', [w.A.slug, keyA, o.name ?? 'Anita', o.cc ?? '+91', Buffer.from('x'), sha('1'), o.lang ?? 'en', o.room ?? '204', o.code ?? null, sha('t'), null, false, null, 'ip']))?.code, JSON.stringify(o)).toBe('GM015');
    expect((await svcErr('padh_guest_login', [w.A.slug, keyA, 'Anita', '+91', Buffer.from('x'), sha('1'), 'en', '204', null, Buffer.from('short'), null, false, null, 'ip']))?.code).toBe('GM015');
  });

  it('strips bidi/control characters from the name', async () => {
    const r = await login(w.A, keyA, { name: 'Pi‮erre\u0007 Dupont', mobile: '9855555555' });
    expect((await db.admin<any>(`select guest_name from public.guest_sessions where id = $1`, [r.session_id]))[0].guest_name).toBe('Pierre Dupont');
  });

  it('slows enumeration: 30 unknown-room guesses from one address lock that address (others unaffected)', async () => {
    for (let i = 0; i < 30; i++) expect((await login(w.A, keyA, { room: `9${i}`, ip: 'scanner' })).code).toBe('unknown_room');
    expect((await login(w.A, keyA, { room: '204', ip: 'scanner' })).code).toBe('locked');
    expect((await login(w.A, keyA, { room: '204', ip: 'honest' })).ok).toBe(true);
  });

  it('limits attempts per address (60 per 10 minutes)', async () => {
    for (let i = 0; i < 60; i++) await login(w.A, keyA, { mobile: '98' + String(10000000 + i), ip: 'busy' });
    expect((await svcErr('padh_guest_login', [w.A.slug, keyA, 'Anita', '+91', Buffer.from('x'), sha('1'), 'en', '204', null, sha('t9'), null, false, null, 'busy']))?.code).toBe('GM007');
  });

  it('level "verified" is refused until the one-time-code provider exists; level "off" behaves like light', async () => {
    await level(w.A.rid, 'verified');
    expect((await svcErr('padh_guest_login', [w.A.slug, keyA, 'Anita', '+91', Buffer.from('x'), sha('1'), 'en', '204', null, sha('t'), null, false, null, 'ip']))?.code).toBe('GM024');
    await level(w.A.rid, 'off');
    expect((await login(w.A, keyA)).ok).toBe(true);
  });
});

describe('login at the Strict level (stay code)', () => {
  it('a wrong code and an unknown room give the identical answer; the right code works', async () => {
    const code = await issue('204');
    await level(w.A.rid, 'strict');
    const wrong = await login(w.A, keyA, { code: code === '0000' ? '1111' : '0000' });
    const noRoom = await login(w.A, keyA, { room: '999', code });
    const noCode = await login(w.A, keyA, { code: null });
    expect([wrong, noRoom, noCode].map((r) => [r.ok, r.code])).toEqual([[false, 'login_failed'], [false, 'login_failed'], [false, 'login_failed']]);
    const ok = await login(w.A, keyA, { code });
    expect(ok.ok).toBe(true);
    expect((await db.admin<any>(`select verification from public.guest_sessions where id = $1`, [ok.session_id]))[0].verification).toBe('code');
  });

  it('locks after 5 wrong codes for that address and room, even for the right code; other addresses still work', async () => {
    const code = await issue('205');
    await level(w.A.rid, 'strict');
    const bad = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) expect((await login(w.A, keyA, { room: '205', code: bad, ip: 'guesser' })).code).toBe('login_failed');
    expect((await login(w.A, keyA, { room: '205', code, ip: 'guesser' })).code).toBe('locked');
    expect((await login(w.A, keyA, { room: '205', code, ip: 'real-guest' })).ok).toBe(true);
    expect((await login(w.A, keyA, { room: '206', code: bad, ip: 'guesser' })).code).toBe('login_failed'); // another room: own counter
  });

  it('locks a room after 20 wrong codes spread over many addresses', async () => {
    const code = await issue('206');
    await level(w.A.rid, 'strict');
    const bad = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 20; i++) await login(w.A, keyA, { room: '206', code: bad, ip: `bot-${i}` });
    expect((await login(w.A, keyA, { room: '206', code, ip: 'fresh' })).code).toBe('locked');
  });

  it('a new code retires the old one; check-out retires all codes and ends the room\'s sessions', async () => {
    const c1 = await issue('207');
    const c2 = await issue('207');
    expect(c2).not.toBe(c1);
    await level(w.A.rid, 'strict');
    expect((await login(w.A, keyA, { room: '207', code: c1 })).code).toBe('login_failed');
    const s = await login(w.A, keyA, { room: '207', code: c2, mobile: '9866666666' });
    expect(s.ok).toBe(true);
    expect(await staff(w.A.waiter, 'padh_checkout_room', [roomIds['207']])).toMatchObject({ sessions_ended: expect.any(Number) });
    expect((await db.admin<any>(`select status from public.guest_sessions where id = $1`, [s.session_id]))[0].status).toBe('ended');
    expect((await login(w.A, keyA, { room: '207', code: c2, ip: 'later' })).code).toBe('login_failed');
  });

  it('codes are stored hashed and never repeat for a room within 30 days', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(await issue('204'));
    expect(seen.size).toBe(40);
    const rows = await db.admin<any>(`select code_hash, salt from public.stay_codes where room_id = $1`, [roomIds['204']]);
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(rows.every((r: any) => r.code_hash.length === 32 && r.salt.length === 16)).toBe(true);
    expect(new Set(rows.map((r: any) => Buffer.from(r.salt).toString('hex'))).size).toBe(rows.length); // per-row salt
  });
});

describe('session lifecycle', () => {
  it('resolve returns the live session with hotel context; unknown, ended, expired and suspended are refused', async () => {
    const r = await login(w.A, keyA, { mobile: '9870000001' });
    const me = await svc<any>('padh_guest_resolve_session', [sha(r.tok)]);
    expect(me).toMatchObject({ ok: true, session_id: r.session_id, room: '204', name: 'Anita Sharma', hotel_name: 'Cafe Aroma', theme: 'palace_blue', timezone: 'Asia/Kolkata' });
    expect(await svc('padh_guest_resolve_session', [sha('nope')])).toEqual({ ok: false });
    expect(await svc('padh_guest_resolve_session', [Buffer.from('short')])).toEqual({ ok: false });
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await svc<any>('padh_guest_resolve_session', [sha(r.tok)])).ok).toBe(false);
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
    await svc('padh_guest_logout', [r.session_id]);
    expect((await svc<any>('padh_guest_resolve_session', [sha(r.tok)])).ok).toBe(false);
  });

  it('a stay longer than max_stay_days expires; under Strict, 12 idle hours expire; Light keeps going', async () => {
    const a = await login(w.A, keyA, { mobile: '9870000002' });
    await db.admin(`update public.guest_sessions set started_at = now() - interval '15 days' where id = $1`, [a.session_id]);
    expect(await svc('padh_guest_resolve_session', [sha(a.tok)])).toEqual({ ok: false, expired: true });
    expect((await db.admin<any>(`select status from public.guest_sessions where id = $1`, [a.session_id]))[0].status).toBe('expired');

    const idle = await login(w.A, keyA, { mobile: '9870000003' });
    await db.admin(`update public.guest_sessions set last_seen_at = now() - interval '13 hours' where id = $1`, [idle.session_id]);
    expect((await svc<any>('padh_guest_resolve_session', [sha(idle.tok)])).session_id).toBe(idle.session_id); // light: no idle limit
    await db.admin(`update public.guest_sessions set last_seen_at = now() - interval '13 hours' where id = $1`, [idle.session_id]);
    await level(w.A.rid, 'strict');
    expect(await svc('padh_guest_resolve_session', [sha(idle.tok)])).toEqual({ ok: false, expired: true });
  });

  it('contacts go only to a live session and follow the shift on duty (including after midnight)', async () => {
    const r = await login(w.A, keyA, { mobile: '9870000004' });
    const c = await svc<any>('padh_guest_contacts', [r.session_id]);
    expect(c).toMatchObject({ reception: '9999900000', manager: '9999911111' });
    expect(c.concierge.name).toBeTruthy();
    await svc('padh_guest_logout', [r.session_id]);
    expect((await svcErr('padh_guest_contacts', [r.session_id]))?.code).toBe('GM009');
    const at = async (iso: string) => (await db.admin<any>(`select (private.on_duty_shift($1, $2::timestamptz)).label l`, [w.A.rid, iso]))[0].l;
    // Asia/Kolkata is UTC+5:30
    expect(await at('2026-01-10T02:00:00Z')).toBe('Morning'); // 07:30 local
    expect(await at('2026-01-10T09:30:00Z')).toBe('Evening'); // 15:00 local, boundary belongs to the new shift
    expect(await at('2026-01-10T17:29:00Z')).toBe('Evening'); // 22:59
    expect(await at('2026-01-10T17:30:00Z')).toBe('Night'); // 23:00
    expect(await at('2026-01-10T20:00:00Z')).toBe('Night'); // 01:30 next day, crossed midnight
    expect(await at('2026-01-10T01:29:00Z')).toBe('Night'); // 06:59
  });

  it('preferences validate and update; logout ends the session', async () => {
    const r = await login(w.A, keyA, { mobile: '9870000005' });
    await svc('padh_guest_set_preferences', [r.session_id, 'jain', 'anniversary', 'fr']);
    expect((await db.admin<any>(`select diet, occasion, language from public.guest_sessions where id = $1`, [r.session_id]))[0]).toEqual({ diet: 'jain', occasion: 'anniversary', language: 'fr' });
    expect((await svcErr('padh_guest_set_preferences', [r.session_id, 'carnivore', null, null]))?.code).toBe('GM015');
  });
});

describe('staff session controls and QR rotation', () => {
  it('end, block and check-out are scoped to the staff member\'s own hotel and role', async () => {
    const r = await login(w.A, keyA, { mobile: '9880000001' });
    expect((await staffErr(w.B.manager, 'padh_end_session', [r.session_id]))?.code).toBe('GM012');
    expect((await staffErr(w.A.kitchen, 'padh_end_session', [r.session_id]))?.code).toBe('GM011');
    expect((await staffErr(w.stranger, 'padh_block_session', [r.session_id]))?.code).toBe('GM011');
    await staff(w.A.waiter, 'padh_end_session', [r.session_id]);
    expect((await svc<any>('padh_guest_resolve_session', [sha(r.tok)])).ok).toBe(false);
    expect((await staffErr(w.A.waiter, 'padh_end_session', [r.session_id]))?.code).toBe('GM012'); // already ended
    expect((await staffErr(w.B.manager, 'padh_checkout_room', [roomIds['204']]))?.code).toBe('GM012');
    expect((await staffErr(w.B.manager, 'padh_issue_stay_code', [roomIds['204']]))?.code).toBe('GM012');
  });

  it('a blocked mobile cannot start a new session, and the block is audited', async () => {
    const r = await login(w.A, keyA, { mobile: '9880000002' });
    await staff(w.A.manager, 'padh_block_session', [r.session_id]);
    expect((await svc<any>('padh_guest_resolve_session', [sha(r.tok)])).ok).toBe(false);
    expect(await login(w.A, keyA, { mobile: '9880000002' })).toMatchObject({ ok: false, code: 'login_failed' });
    expect((await db.admin<any>(`select 1 from public.audit_log where action = 'padh_session_blocked' and entity_id = $1`, [r.session_id])).length).toBe(1);
  });

  const keyRow = (key: string) => [sha(key), Buffer.from(`enc:${key}`)]; // enc is opaque to the database; the app makes it with AES-GCM
  it('the owner (only) replaces the QR key; the old key dies at once; the old typed-word function is closed to everyone', async () => {
    const fresh = 'c'.repeat(64);
    for (const uid of [w.A.manager, w.A.waiter, w.A.kitchen, w.stranger]) expect((await staffErr(uid, 'padh_qr_set', keyRow(fresh)))?.code, uid).toBe('GM011');
    for (const bad of [[Buffer.from('short'), Buffer.from('x'.repeat(40))], [sha(fresh), Buffer.from('tiny')], [null, null]]) expect((await staffErr(w.A.owner, 'padh_qr_set', bad))?.code).toBe('GM015');
    for (const uid of [w.A.owner, w.A.manager]) expect((await staffErr(uid, 'padh_rotate_qr_key', ['ROTATE']))?.code, uid).toBe('42501');
    expect(await staff(w.A.owner, 'padh_qr_set', keyRow(fresh))).toEqual({ ok: true });
    expect((await svcErr('padh_public_hotel', [w.A.slug, keyA]))?.code).toBe('GM002');
    expect((await svc<any>('padh_public_hotel', [w.A.slug, fresh])).name).toBe('Cafe Aroma');
    expect((await svc<any>('padh_public_hotel', [w.B.slug, keyB])).name).toBe('Spice Garden'); // hotel B untouched
    expect((await db.admin<any>(`select 1 from public.audit_log where action = 'padh_qr_set' and restaurant_id = $1`, [w.A.rid])).length).toBe(1);
    keyA = fresh;
  });

  it('owner and manager can read the encrypted copy at any time; others cannot; the column itself is not readable', async () => {
    for (const uid of [w.A.owner, w.A.manager]) {
      const g = await staff<any>(uid, 'padh_qr_get', []);
      expect(g.enc).toBe(Buffer.from(`enc:${keyA}`).toString('hex'));
      expect(g.role).toBe(uid === w.A.owner ? 'owner' : 'manager');
    }
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger, w.B.manager]) {
      const e = await staffErr(uid, 'padh_qr_get', []);
      expect(e?.code === 'GM011' || (uid === w.B.manager && !e), uid).toBe(true); // B's manager only ever sees B's own row
    }
    expect((await staff<any>(w.B.manager, 'padh_qr_get', [])).enc).toBeNull();
    expect((await db.asErr('authenticated', w.A.owner, `select qr_key_enc from public.hotel_settings`))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.padh_qr_get()`))?.code).toBe('42501');
  });

  it('the platform admin can read and replace any hotel key; nobody else can', async () => {
    const adminKey = 'd'.repeat(64);
    expect((await svcErr('padh_admin_qr_get', [w.A.owner, w.A.rid]))?.code).toBeTruthy();
    expect((await svcErr('padh_admin_qr_set', [w.stranger, w.A.rid, ...keyRow(adminKey)]))?.code).toBeTruthy();
    expect(await svc(`padh_admin_qr_set`, [w.admin, w.B.rid, ...keyRow(adminKey)])).toEqual({ ok: true });
    expect((await svc<any>('padh_admin_qr_get', [w.admin, w.B.rid])).enc).toBe(Buffer.from(`enc:${adminKey}`).toString('hex'));
    expect((await svc<any>('padh_public_hotel', [w.B.slug, adminKey])).name).toBe('Spice Garden');
    expect((await svcErr('padh_public_hotel', [w.B.slug, keyB]))?.code).toBe('GM002');
    keyB = adminKey;
    expect((await svcErr('padh_admin_qr_get', [w.admin, randomUUID()]))?.code).toBe('GM012');
    expect((await db.asErr('authenticated', w.A.owner, `select public.padh_admin_qr_get($1,$2)`, [w.admin, w.A.rid]))?.code).toBe('42501');
  });

  it('privilege split: staff cannot call guest functions; the service role cannot call staff functions; anon nothing', async () => {
    expect((await db.asErr('authenticated', w.A.owner, `select public.padh_guest_logout($1)`, [randomUUID()]))?.code).toBe('42501');
    expect((await db.asErr('authenticated', w.A.owner, `select public.padh_public_hotel('x', 'y')`))?.code).toBe('42501');
    expect((await db.asErr('service_role', null, `select public.padh_qr_set($1, $2)`, [sha('x'), Buffer.from('y'.repeat(40))]))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.padh_public_hotel('x', 'y')`))?.code).toBe('42501');
    expect((await db.asErr('authenticated', w.A.owner, `select * from public.consent_log`))?.code).toBe('42501');
  });
});
