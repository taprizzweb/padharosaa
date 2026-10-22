import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, type World } from '../../supabase/tests/helpers/fixtures';
import { totp } from '../../supabase/tests/helpers/totp';
import { authState, req, state, storageState, uniqueIp } from './helpers';
import { GET as adminGET, POST as adminPOST } from '@/app/api/admin/[action]/route';
import { POST as enrollPOST } from '@/app/api/auth/mfa/enroll/route';
import { POST as verifyPOST } from '@/app/api/auth/mfa/verify/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as dashGET } from '@/app/api/dash/[action]/route';
import { GET as boardGET } from '@/app/api/staff/board/route';

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
  authState.aal = 'aal2';
  authState.factors.clear();
  authState.deleted.length = 0;
});

const as = (uid: string | null, aal: 'aal1' | 'aal2' = 'aal2') => {
  authState.userId = uid;
  authState.aal = aal;
};
const json = async (r: Response) => (await r.json()) as Record<string, any>;
const aCtx = (a: string) => ({ params: Promise.resolve({ action: a }) });
const aPost = (a: string, body: unknown, o = {}) => adminPOST(req(`/api/admin/${a}`, body, o), aCtx(a));
import { POST as dashPOST } from '@/app/api/dash/[action]/route';
const adminlessPost = (a: string, body: unknown) => dashPOST(req(`/api/dash/${a}`, body), aCtx(a));
const aGet = (a: string, q = '') => adminGET(req(`/api/admin/${a}${q}`), aCtx(a));

describe('restaurant staff need only email + password', () => {
  it('owners, managers, waiters and kitchen work with a password-only session (aal1)', async () => {
    for (const uid of [w.A.owner, w.A.manager]) {
      as(uid, 'aal1');
      expect((await dashGET(req('/api/dash/menu'), aCtx('menu'))).status).toBe(200);
      expect((await boardGET(req('/api/staff/board'))).status).toBe(200);
    }
    for (const uid of [w.A.waiter, w.A.kitchen]) {
      as(uid, 'aal1');
      expect((await boardGET(req('/api/staff/board'))).status).toBe(200);
    }
  });
  it('roles still apply: waiters and strangers cannot use the dashboard', async () => {
    for (const uid of [w.A.waiter, w.stranger]) {
      as(uid, 'aal1');
      expect((await dashGET(req('/api/dash/menu'), aCtx('menu'))).status).toBe(403);
    }
  });
});

describe('authenticator setup and verification routes', () => {
  const enroll = () => enrollPOST(req('/api/auth/mfa/enroll', {}));
  const verify = (factor_id: string, code: string) => verifyPOST(req('/api/auth/mfa/verify', { factor_id, code }, { ip: uniqueIp() }));

  it('need a session and our origin', async () => {
    expect((await enroll()).status).toBe(401);
    as(w.A.owner, 'aal1');
    expect((await enrollPOST(req('/api/auth/mfa/enroll', {}, { origin: 'https://evil.example' }))).status).toBe(403);
  });
  it('set up once: the right code lifts the session to aal2; a second setup is refused', async () => {
    as(w.A.owner, 'aal1');
    const r = await enroll();
    expect(r.status).toBe(200);
    const { factor_id, secret, qr_code } = await json(r);
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(qr_code).toMatch(/^data:image\/svg\+xml/);
    expect((await verify(factor_id, '000000')).status).toBe(401);
    expect(authState.aal).toBe('aal1');
    expect((await verify(factor_id, totp(secret))).status).toBe(200);
    expect(authState.aal).toBe('aal2');
    expect((await enroll()).status).toBe(409);
  });
  it('abandoned setups are replaced, so only one pending factor exists', async () => {
    as(w.A.manager, 'aal1');
    await enroll();
    await enroll();
    expect(authState.factors.get(w.A.manager)!.length).toBe(1);
  });
  it('after 5 wrong codes even the right code is refused for a while (no guessing 6 digits)', async () => {
    as(w.B.owner, 'aal1');
    const { factor_id, secret } = await json(await enroll());
    for (let i = 0; i < 5; i++) expect((await verify(factor_id, '111111')).status).toBe(401);
    const blocked = await verify(factor_id, totp(secret));
    expect(blocked.status).toBe(429);
    expect(authState.aal).toBe('aal1');
  });
  it('rejects codes that are not six digits and factors that are not yours', async () => {
    as(w.A.waiter, 'aal1');
    const { factor_id } = await json(await enroll());
    expect((await verify(factor_id, 'abcdef')).status).toBe(400);
    expect((await verify('3f2504e0-4f89-41d3-9a0c-0305e82c3301', '123456')).status).toBe(404);
  });
});

describe('platform admin API', () => {
  it('needs sign-in, then the platform_admins row (password only, no authenticator)', async () => {
    expect((await aGet('restaurants')).status).toBe(401);
    as(w.admin, 'aal1');
    expect((await aGet('restaurants')).status).toBe(200);
    for (const uid of [w.A.owner, w.A.manager, w.stranger]) {
      as(uid, 'aal2');
      const x = await aGet('restaurants');
      expect(x.status, uid).toBe(403);
      expect((await json(x)).error.key).toBe('forbidden');
    }
  });
  it('lists restaurants with last activity; unknown actions 404; wrong method 405; foreign origin refused', async () => {
    as(w.admin);
    const r = await json(await aGet('restaurants'));
    expect(r.restaurants.length).toBeGreaterThanOrEqual(2);
    expect(r.restaurants[0]).toHaveProperty('last_order_at');
    expect((await aGet('nope')).status).toBe(404);
    expect((await aGet('constructor')).status).toBe(404);
    expect((await aPost('restaurants', {})).status).toBe(405);
    expect((await aPost('set-status', { id: w.A.rid, status: 'suspended' }, { origin: 'https://evil.example' })).status).toBe(403);
  });
  it('creates a restaurant and owner login with a one-time temporary password that must be changed', async () => {
    as(w.admin);
    const r = await aPost('create-restaurant', { slug: 'new-cafe', name: 'New Cafe', owner_email: 'Owner@NewCafe.test', owner_name: 'Nina', plan: 'pilot', paid_until: null });
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(b.temporary_password.length).toBeGreaterThanOrEqual(14);
    expect(b.owner_email).toBe('owner@newcafe.test');
    const [owner] = await db.admin<{ role: string; user_id: string }>(`select role, user_id from public.staff where restaurant_id = $1`, [b.id]);
    expect(owner!.role).toBe('owner');
    expect(authState.meta.get(owner!.user_id)?.app_metadata).toMatchObject({ must_change_password: true });
    const [a] = await db.admin<{ action: string; actor_role: string }>(`select action, actor_role from public.audit_log where restaurant_id = $1 and action = 'restaurant_created'`, [b.id]);
    expect(a).toMatchObject({ actor_role: 'platform_admin' });
  });
  it('lists a restaurant\'s logins, resets a password and corrects an email (audit-logged, other restaurants refused)', async () => {
    as(w.admin);
    const l = await aGet('staff', `?id=${w.A.rid}`);
    expect(l.status).toBe(200);
    const { staff } = await json(l);
    const owner = staff.find((x: any) => x.role === 'owner');
    expect(staff[0].role).toBe('owner');
    expect(owner.email).toBeTruthy();
    const reset = await aPost('staff-reset-password', { id: w.A.rid, user_id: owner.user_id });
    expect(reset.status).toBe(200);
    expect((await json(reset)).temporary_password.length).toBeGreaterThanOrEqual(14);
    expect(authState.meta.get(owner.user_id)?.app_metadata).toMatchObject({ must_change_password: true });
    const ch = await aPost('staff-change-email', { id: w.A.rid, user_id: owner.user_id, email: 'New.Owner@Example.test' });
    expect(ch.status).toBe(200);
    const [row] = await db.admin<{ email: string }>(`select email from auth.users where id = $1`, [owner.user_id]);
    expect(row!.email).toBe('new.owner@example.test');
    const dup = await aPost('staff-change-email', { id: w.A.rid, user_id: owner.user_id, email: staff.find((x: any) => x.role !== 'owner')!.email });
    expect(dup.status).toBe(409);
    // a login of restaurant A cannot be touched through restaurant B
    expect((await aPost('staff-reset-password', { id: w.B.rid, user_id: owner.user_id })).status).toBe(404);
    const acts = await db.admin<{ action: string; actor_role: string }>(`select action, actor_role from public.audit_log where restaurant_id = $1 and action in ('staff_password_reset','staff_email_changed') order by id`, [w.A.rid]);
    expect(acts.map((a) => a.action)).toEqual(['staff_password_reset', 'staff_email_changed', 'staff_email_changed']); // the refused duplicate is logged as an attempt
    expect(acts.every((a) => a.actor_role === 'platform_admin')).toBe(true);
    // not for restaurant owners
    as(w.A.owner);
    expect((await aPost('staff-reset-password', { id: w.A.rid, user_id: owner.user_id })).status).toBe(403);
    expect((await aGet('staff', `?id=${w.A.rid}`)).status).toBe(403);
  });
  it('adds an owner, manager, waiter or kitchen login with a one-time temporary password; no orphan login on failure', async () => {
    as(w.admin);
    for (const role of ['owner', 'manager', 'waiter', 'kitchen']) {
      const r = await aPost('staff-add', { id: w.B.rid, email: `Added.${role}@Example.test`, name: `Added ${role}`, role });
      expect(r.status, role).toBe(201);
      const b = await json(r);
      expect(b.temporary_password.length).toBeGreaterThanOrEqual(14);
      expect(authState.meta.get(b.user_id)?.app_metadata).toMatchObject({ must_change_password: true });
      const [row] = await db.admin<{ role: string; restaurant_id: string; active: boolean }>(`select role, restaurant_id, active from public.staff where user_id = $1`, [b.user_id]);
      expect(row).toMatchObject({ role, restaurant_id: w.B.rid, active: true });
    }
    const dup = await aPost('staff-add', { id: w.B.rid, email: 'added.kitchen@example.test', name: 'Again', role: 'kitchen' });
    expect(dup.status).toBe(409);
    expect((await aPost('staff-add', { id: w.B.rid, email: 'x@example.test', name: 'X', role: 'admin' })).status).toBe(400);
    expect((await aPost('staff-add', { id: randomUUID(), email: 'nobody@example.test', name: 'X', role: 'waiter' })).status).toBe(404);
    expect(await db.admin(`select 1 from auth.users where email = 'nobody@example.test'`)).toHaveLength(0);
    const acts = await db.admin<{ actor_role: string }>(`select actor_role from public.audit_log where restaurant_id = $1 and action = 'staff_added'`, [w.B.rid]);
    expect(acts).toHaveLength(4);
    as(w.A.owner);
    expect((await aPost('staff-add', { id: w.A.rid, email: 'sneaky@example.test', name: 'S', role: 'owner' })).status).toBe(403);
  });
  it('plans: the admin defines name, points and prices; a restaurant gets its own price and dates; not available to restaurant staff', async () => {
    as(w.admin);
    const r = await aPost('plan-save', { name: 'Signature', points: ['Premium menu', 'QR ordering', ''], setup_fee_paise: 1500000, monthly_paise: 249900, yearly_paise: 2499900, active: true, sort_order: 1 });
    expect(r.status).toBe(200);
    const { id: planId } = await json(r);
    const list = await json(await aGet('plans'));
    expect(list.plans.find((p: any) => p.id === planId)).toMatchObject({ name: 'Signature', points: ['Premium menu', 'QR ordering'], monthly_paise: 249900 });
    expect((await aPost('plan-save', { name: 'signature', points: [], setup_fee_paise: 0, monthly_paise: 0, yearly_paise: 0, active: true })).status).toBe(409);
    expect((await aPost('plan-save', { name: 'X', points: [], setup_fee_paise: -5, monthly_paise: 0, yearly_paise: 0, active: true })).status).toBe(400);
    expect((await aPost('plan-save', { name: 'X', points: ['x'.repeat(130)], setup_fee_paise: 0, monthly_paise: 0, yearly_paise: 0, active: true })).status).toBe(400);
    expect((await aPost('billing-save', { id: w.B.rid, plan_id: planId, plan_name: 'Signature', price_paise: 199900, period: 'yearly', setup_fee_paise: 1000000, starts_at: '2026-11-01T00:00:00.000Z', paid_until: '2027-10-31T18:29:59.000Z', auto_pause: true, grace_days: 3, note: 'Founding client' })).status).toBe(200);
    const [row] = await db.admin<any>(`select plan, price_paise, billing_period, auto_pause, grace_days from public.restaurants where id = $1`, [w.B.rid]);
    expect(row).toMatchObject({ plan: 'Signature', price_paise: 199900, billing_period: 'yearly', auto_pause: true, grace_days: 3 });
    const listed = (await json(await aGet('restaurants'))).restaurants.find((x: any) => x.id === w.B.rid);
    expect(listed).toMatchObject({ plan_id: planId, price_paise: 199900, billing_period: 'yearly', grace_days: 3 });
    expect((await aPost('plan-delete', { id: planId })).status).toBe(409); // in use
    expect((await aPost('billing-save', { id: w.B.rid, plan_id: null, plan_name: 'Signature', price_paise: 1, period: 'weekly', setup_fee_paise: 0, auto_pause: false, grace_days: 0 })).status).toBe(400);
    as(w.A.owner);
    for (const [a, body] of [['plan-save', { name: 'Own', points: [], setup_fee_paise: 0, monthly_paise: 0, yearly_paise: 0, active: true }], ['billing-save', { id: w.A.rid, plan_id: null, plan_name: 'x', price_paise: 0, period: 'monthly', setup_fee_paise: 0, auto_pause: false, grace_days: 0 }], ['restaurant-rename', { id: w.A.rid, name: 'Mine' }]] as const) {
      expect((await aPost(a, body)).status, a).toBe(403);
    }
    expect((await aGet('plans')).status).toBe(403);
  });
  it('renames a restaurant and a login (names only; the web address and email stay)', async () => {
    as(w.admin);
    expect((await aPost('restaurant-rename', { id: w.B.rid, name: '  Cafe Aroma Deluxe ' })).status).toBe(200);
    expect((await db.admin<any>(`select name, slug from public.restaurants where id = $1`, [w.B.rid]))[0]).toMatchObject({ name: 'Cafe Aroma Deluxe', slug: w.B.slug });
    expect((await aPost('restaurant-rename', { id: w.B.rid, name: '' })).status).toBe(400);
    expect((await aPost('staff-rename', { id: w.B.rid, user_id: w.B.waiter, name: 'Ravi Kumar' })).status).toBe(200);
    expect((await db.admin<any>(`select display_name from public.staff where user_id = $1`, [w.B.waiter]))[0].display_name).toBe('Ravi Kumar');
    expect((await aPost('staff-rename', { id: w.A.rid, user_id: w.B.waiter, name: 'Wrong' })).status).toBe(404);
  });
  it('duplicates a restaurant: copies menu and photos, gives a new owner a temporary password, and leaves no half-made login behind', async () => {
    as(w.admin);
    const photo = `${w.A.rid}/11111111-1111-4111-8111-111111111111.webp`;
    await db.admin(`update public.items set image_path = $2 where id = $1`, [w.A.paneer, photo]);
    storageState.copied.length = 0;
    const r = await aPost('duplicate-restaurant', { source_id: w.A.rid, slug: 'copy-one', name: 'Copy One', owner_email: 'Copy.Owner@Example.test', owner_name: 'Cora' });
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(b).toMatchObject({ slug: 'copy-one', owner_email: 'copy.owner@example.test', photos_copied: 1, photos_failed: 0 });
    expect(b.temporary_password.length).toBeGreaterThanOrEqual(14);
    expect(storageState.copied).toHaveLength(1);
    expect(storageState.copied[0]![0]).toBe(photo);
    expect(storageState.copied[0]![1].startsWith(`${b.id}/`)).toBe(true);
    expect(authState.meta.get((await db.admin<any>(`select user_id from public.staff where restaurant_id = $1`, [b.id]))[0].user_id)?.app_metadata).toMatchObject({ must_change_password: true });
    // a photo that cannot be copied is dropped from the copy instead of pointing at nothing
    storageState.failOn.add(photo);
    const r2 = await aPost('duplicate-restaurant', { source_id: w.A.rid, slug: 'copy-two', name: 'Copy Two', owner_email: 'copy2@example.test', owner_name: 'Cy' });
    storageState.failOn.clear();
    expect(await json(r2)).toMatchObject({ photos_copied: 0, photos_failed: 1 });
    expect((await db.admin<any>(`select count(*)::int n from public.items where restaurant_id = (select id from public.restaurants where slug = 'copy-two') and image_path is not null`))[0].n).toBe(0);
    // refused: taken address, taken email, unknown source; nothing is left behind
    expect((await aPost('duplicate-restaurant', { source_id: w.A.rid, slug: 'copy-one', name: 'Again', owner_email: 'fresh@example.test', owner_name: 'F' })).status).toBe(409);
    expect(await db.admin(`select 1 from auth.users where email = 'fresh@example.test'`)).toHaveLength(0);
    expect((await aPost('duplicate-restaurant', { source_id: w.A.rid, slug: 'copy-three', name: 'T', owner_email: 'copy.owner@example.test', owner_name: 'F' })).status).toBe(409);
    expect((await aPost('duplicate-restaurant', { source_id: randomUUID(), slug: 'copy-four', name: 'T', owner_email: 'four@example.test', owner_name: 'F' })).status).toBe(404);
    expect(await db.admin(`select 1 from auth.users where email = 'four@example.test'`)).toHaveLength(0);
    as(w.A.owner);
    expect((await aPost('duplicate-restaurant', { source_id: w.A.rid, slug: 'sneaky', name: 'S', owner_email: 's@example.test', owner_name: 'S' })).status).toBe(403);
  });
  it('an expired plan with automatic pause refuses new orders', async () => {
    as(w.admin);
    await aPost('billing-save', { id: w.A.rid, plan_id: null, plan_name: 'Test', price_paise: 0, period: 'monthly', setup_fee_paise: 0, paid_until: new Date(Date.now() - 20 * 86400_000).toISOString(), auto_pause: true, grace_days: 1, note: '' });
    const [t] = await db.admin<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1, 'EXP1') returning qr_token`, [w.A.rid]);
    const { POST: orderPOST } = await import('@/app/api/guest/order/route');
    const res = await orderPOST(req('/api/guest/order', { slug: w.A.slug, token: t!.qr_token, idempotency_key: randomUUID(), items: [{ item_id: w.A.chai, qty: 1 }] }, { ip: uniqueIp() }));
    expect(res.status).toBe(403);
    expect((await json(res)).error.key).toBe('restaurant_suspended');
    await aPost('billing-save', { id: w.A.rid, plan_id: null, plan_name: 'Test', price_paise: 0, period: 'monthly', setup_fee_paise: 0, paid_until: null, auto_pause: true, grace_days: 0, note: '' });
  });
  it('refuses duplicate slugs, reserved slugs, bad emails and does not leave a login behind', async () => {
    as(w.admin);
    const before = (await db.admin(`select 1 from auth.users`)).length;
    const dup = await aPost('create-restaurant', { slug: 'new-cafe', name: 'Again', owner_email: 'again@x.test', owner_name: 'A', plan: 'pilot', paid_until: null });
    expect(dup.status).toBe(409);
    expect((await aPost('create-restaurant', { slug: 'admin', name: 'X', owner_email: 'x@x.test', owner_name: 'A' })).status).toBe(400);
    expect((await aPost('create-restaurant', { slug: 'ok-name', name: 'X', owner_email: 'not-an-email', owner_name: 'A' })).status).toBe(400);
    expect((await aPost('create-restaurant', { slug: 'ok-name', name: 'X', owner_email: 'owner@newcafe.test', owner_name: 'A' })).status).toBe(409); // email already used
    expect((await db.admin(`select 1 from auth.users`)).length).toBe(before);
  });
  it('suspend / activate and plan changes are applied and audit-logged; suspension blocks staff writes at once', async () => {
    as(w.admin);
    expect((await aPost('set-status', { id: w.B.rid, status: 'suspended' })).status).toBe(200);
    as(w.B.owner);
    expect((await dashGET(req('/api/dash/settings'), aCtx('settings'))).status).toBe(200); // still readable
    const w2 = await adminlessPost('settings-save', { name: 'Nope', review_url: '', accent: 'teal', amber_minutes: 5, red_minutes: 10 });
    expect(w2.status).toBe(403);
    expect((await json(w2)).error.key).toBe('restaurant_suspended');
    const [s] = await db.admin<{ status: string }>(`select status from public.restaurants where id = $1`, [w.B.rid]);
    expect(s!.status).toBe('suspended');
    as(w.admin);
    expect((await aPost('set-status', { id: w.B.rid, status: 'active' })).status).toBe(200);
    expect((await aPost('billing-save', { id: w.B.rid, plan_id: null, plan_name: 'standard', price_paise: 0, period: 'monthly', setup_fee_paise: 0, paid_until: '2027-03-31T18:29:59.000Z', auto_pause: false, grace_days: 0, note: '' })).status).toBe(200);
    const [p] = await db.admin<{ plan: string }>(`select plan from public.restaurants where id = $1`, [w.B.rid]);
    expect(p!.plan).toBe('standard');
    expect((await aPost('set-status', { id: w.B.rid, status: 'deleted' })).status).toBe(400);
    expect((await aPost('set-status', { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', status: 'active' })).status).toBe(404);
  });
  it('reads any restaurant\'s audit log and exports its data as a download (never QR tokens)', async () => {
    as(w.admin);
    const a = await json(await aGet('audit', `?id=${w.A.rid}`));
    expect(Array.isArray(a.entries)).toBe(true);
    expect((await aGet('audit', '?id=not-a-uuid')).status).toBe(400);
    const e = await aGet('export', `?id=${w.A.rid}`);
    expect(e.status).toBe(200);
    expect(e.headers.get('content-disposition')).toContain('attachment');
    const text = await e.text();
    expect(JSON.parse(text).restaurant.slug).toBe(w.A.slug);
    expect(text).not.toContain(w.A.t1.token);
  });
  it('deleting needs the exact typed slug; then removes the restaurant and its staff logins', async () => {
    as(w.admin);
    const c = await json(await aPost('create-restaurant', { slug: 'to-delete', name: 'Gone Soon', owner_email: 'gone@x.test', owner_name: 'G' }));
    expect((await aPost('delete-restaurant', { id: c.id, confirm_slug: 'wrong' })).status).toBe(400);
    expect((await db.admin(`select 1 from public.restaurants where id = $1`, [c.id])).length).toBe(1);
    const del = await aPost('delete-restaurant', { id: c.id, confirm_slug: 'to-delete' });
    expect(del.status).toBe(200);
    expect((await json(del)).staff_logins_removed).toBe(1);
    expect((await db.admin(`select 1 from public.restaurants where id = $1`, [c.id])).length).toBe(0);
    expect(authState.deleted.length).toBe(1);
    const [k] = await db.admin<{ action: string }>(`select action from public.audit_log where restaurant_id is null and action = 'restaurant_deleted' order by id desc limit 1`);
    expect(k!.action).toBe('restaurant_deleted');
  });
});

describe('sign-in for platform admins', () => {
  it('lets an admin (who is not restaurant staff) sign in and sends them to /admin; strangers still get the generic failure', async () => {
    const [u] = await db.admin<{ email: string }>(`select email from auth.users where id = $1`, [w.admin]);
    const ok = await loginPOST(req('/api/auth/login', { email: u!.email, password: 'correct-horse-battery-staple' }, { ip: uniqueIp() }));
    expect(ok.status).toBe(200);
    expect((await json(ok)).next).toBe('/admin');
    const [s] = await db.admin<{ email: string }>(`select email from auth.users where id = $1`, [w.stranger]);
    const no = await loginPOST(req('/api/auth/login', { email: s!.email, password: 'correct-horse-battery-staple' }, { ip: uniqueIp() }));
    expect(no.status).toBe(401);
  });
});
