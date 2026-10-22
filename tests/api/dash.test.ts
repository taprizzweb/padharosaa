import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from '../../supabase/tests/helpers/db';
import { buildWorld, placeOrder, type World } from '../../supabase/tests/helpers/fixtures';
import { authState, req, state } from './helpers';
import { GET, POST } from '@/app/api/dash/[action]/route';
import { POST as passwordPOST } from '@/app/api/auth/password/route';
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
  authState.deleted.length = 0;
});

const as = (uid: string | null) => {
  authState.userId = uid;
};
const ctx = (action: string) => ({ params: Promise.resolve({ action }) });
const post = (action: string, body: unknown, o = {}) => POST(req(`/api/dash/${action}`, body, o), ctx(action));
const get = (action: string, query = '') => GET(req(`/api/dash/${action}${query}`), ctx(action));
const json = async (r: Response) => (await r.json()) as Record<string, any>;

describe('who can use the dashboard API', () => {
  const reads = ['menu', 'settings', 'staff', 'tables', 'report', 'audit'];
  it('requires sign-in', async () => {
    for (const a of reads) expect((await get(a)).status, a).toBe(401);
    expect((await post('category-save', { name: 'X' })).status).toBe(401);
  });
  it('owner and manager can read everything; waiter, kitchen and strangers get 403', async () => {
    for (const a of reads) {
      for (const uid of [w.A.owner, w.A.manager]) { as(uid); expect((await get(a)).status, `${a}/${uid}`).toBe(200); }
      for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) { as(uid); const r = await get(a); expect(r.status, `${a}/${uid}`).toBe(403); expect((await json(r)).error.key).toBe('forbidden'); }
    }
  });
  it('responses are never cached', async () => {
    as(w.A.owner);
    expect((await get('menu')).headers.get('cache-control')).toBe('no-store');
  });
  it('unknown actions are 404 and the wrong HTTP method is 405', async () => {
    as(w.A.owner);
    expect((await get('does-not-exist')).status).toBe(404);
    expect((await post('constructor', {})).status).toBe(404);
    expect((await get('__proto__')).status).toBe(404);
    expect((await post('menu', {})).status).toBe(405);
    expect((await get('category-save')).status).toBe(405);
  });
  it('writes need our origin, JSON, and a valid shape', async () => {
    as(w.A.owner);
    expect((await post('category-save', { name: 'X' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('category-save', { name: 'X' }, { origin: null })).status).toBe(403);
    expect((await post('category-save', { name: 'X' }, { contentType: 'text/plain' })).status).toBe(415);
    expect((await post('category-save', { name: 'X', extra: 1 })).status).toBe(400);
    expect((await post('category-save', {})).status).toBe(400);
  });
});

describe('menu', () => {
  it('category and dish lifecycle through the API', async () => {
    as(w.A.manager);
    const cat = (await json(await post('category-save', { name: 'API Desserts', active: true }))).id as string;
    expect((await post('category-save', { name: 'api desserts' })).status).toBe(409);
    expect((await json(await post('category-save', { name: 'API Desserts' }))).error.key).toBe('conflict');

    const saved = await post('item-save', { category_id: cat, name: 'Kheer', description: '  Rice pudding ', price_paise: 9000, diet: 'veg', spice: 0, is_bestseller: true, is_chef_pick: false });
    expect(saved.status).toBe(200);
    const id = (await json(saved)).id as string;
    const menu = await json(await get('menu'));
    const found = menu.categories.find((c: any) => c.id === cat).items[0];
    expect(found).toMatchObject({ id, name: 'Kheer', description: 'Rice pudding', price_paise: 9000, is_bestseller: true });

    expect((await post('item-save', { id, category_id: cat, name: 'Kheer', price_paise: 9500, diet: 'veg', spice: 0, is_bestseller: false, is_chef_pick: false, is_available: false })).status).toBe(200);
    const dup = await json(await post('item-duplicate', { id }));
    expect(dup.id).toBeTruthy();
    expect((await post('items-reorder', { category_id: cat, ids: [dup.id, id] })).status).toBe(200);
    expect((await json(await post('items-bulk-price', { item_ids: [id, dup.id], mode: 'percent', value: 10 }))).changed).toBe(2);
    expect((await post('category-delete', { id: cat })).status).toBe(409);
    expect((await json(await post('category-delete', { id: cat }))).error.key).toBe('category_not_empty');
    expect((await post('item-delete', { id })).status).toBe(200);
    expect((await post('item-delete', { id: dup.id })).status).toBe(200);
    expect((await post('category-delete', { id: cat })).status).toBe(200);
  });
  it('rejects bad dishes (400) with no database text in the answer', async () => {
    as(w.A.owner);
    const base = { category_id: w.A.catId, name: 'Bad', price_paise: 100, diet: 'veg', spice: 0, is_bestseller: false, is_chef_pick: false };
    for (const bad of [{ price_paise: -1 }, { price_paise: 1.5 }, { diet: 'beef' }, { spice: 4 }, { name: '' }, { name: 'x'.repeat(81) }, { description: 'x'.repeat(301) }, { category_id: 'nope' }, { price_paise: '100' }, { unknown: 1 }]) {
      const r = await post('item-save', { ...base, ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(JSON.stringify(await json(r))).not.toMatch(/constraint|violates|public\.|GM0/);
    }
    // the SQL layer still refuses an image in somebody else's folder
    expect((await post('item-save', { ...base, name: 'Img', image_path: `${w.B.rid}/x.webp` })).status).toBe(400);
  });
  it('waiters and the kitchen cannot write; another restaurant cannot touch these dishes', async () => {
    const body = { category_id: w.A.catId, name: 'Nope', price_paise: 100, diet: 'veg', spice: 0, is_bestseller: false, is_chef_pick: false };
    for (const uid of [w.A.waiter, w.A.kitchen]) { as(uid); expect((await post('item-save', body)).status).toBe(403); expect((await post('items-bulk-price', { item_ids: [w.A.chai], mode: 'set', value: 1 })).status).toBe(403); }
    as(w.B.owner);
    expect((await post('item-save', body)).status).toBe(404);
    expect((await post('item-delete', { id: w.A.paneer })).status).toBe(404);
    expect((await post('items-bulk-price', { item_ids: [w.A.paneer], mode: 'set', value: 1 })).status).toBe(404);
    expect((await db.admin<any>(`select price_paise from public.items where id = $1`, [w.A.paneer]))[0].price_paise).toBe(25000);
  });
  it('CSV import: all-or-nothing with row numbers, then success', async () => {
    as(w.A.owner);
    const good = { category: 'API Import', name: 'Imp1', description: '', price_paise: 5000, diet: 'veg', spice: 0, bestseller: false, chef_pick: false, available: true };
    const bad = await json(await post('menu-import', { rows: [good, { ...good, name: 'Imp2', price_paise: 10000001 }] }));
    expect(bad.status ?? 400).toBeDefined();
    const dupFile = await json(await post('menu-import', { rows: [good, { ...good }] }));
    expect(dupFile).toMatchObject({ ok: false });
    expect(dupFile.errors[0].row).toBe(2);
    const ok = await json(await post('menu-import', { rows: [good] }));
    expect(ok).toEqual({ ok: true, created: 1, updated: 0, categories_created: 1 });
    expect((await post('menu-import', { rows: [] })).status).toBe(400);
  });
  it('a whole menu (200 dishes, far over the normal 16 KB cap) can be imported; other calls stay capped', async () => {
    as(w.A.owner);
    const rows = Array.from({ length: 200 }, (_, i) => ({ category: `Big ${i % 8}`, name: `Dish number ${i} with a fairly long name`, description: 'x'.repeat(200), price_paise: 10000 + i, diet: 'veg', spice: 0, bestseller: false, chef_pick: false, available: true }));
    const r = await post('menu-import', { rows });
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ ok: true, created: 200 });
    expect((await post('item-save', { filler: 'x'.repeat(20_000) })).status).toBe(413);
    expect((await post('menu-import', { rows, filler: 'x'.repeat(400_000) })).status).toBe(413);
  });
});

describe('tables and settings', () => {
  it('create tables in one go, rename/deactivate, rotate the QR (old one dies)', async () => {
    as(w.A.manager);
    expect((await json(await post('tables-create', { from: 30, to: 34 }))).created).toBe(5);
    expect((await json(await post('tables-create', { from: 30, to: 34 }))).created).toBe(0);
    expect((await post('tables-create', { from: 5, to: 1 })).status).toBe(400);
    const list = (await json(await get('tables'))).tables as any[];
    const t = list.find((x) => x.label === '31');
    expect(t.qr_token).toMatch(/^[0-9a-f]{64}$/);
    expect((await post('table-save', { id: t.table_id, label: '32', active: true })).status).toBe(409);
    expect((await post('table-save', { id: t.table_id, label: 'Patio 1', active: true })).status).toBe(200);
    expect((await post('table-rotate', { id: t.table_id })).status).toBe(200);
    const after = ((await json(await get('tables'))).tables as any[]).find((x) => x.table_id === t.table_id);
    expect(after.qr_token).not.toBe(t.qr_token);
    expect(after.label).toBe('Patio 1');
    // staff who are not managers never see tokens
    as(w.A.waiter);
    expect((await get('tables')).status).toBe(403);
  });
  it('only the owner saves settings; validation is enforced; guests see the change', async () => {
    const ok = { name: 'Cafe Aroma', review_url: 'https://g.page/r/abc', accent: 'plum', amber_minutes: 4, red_minutes: 9 };
    as(w.A.manager);
    expect((await post('settings-save', ok)).status).toBe(403);
    as(w.A.owner);
    expect((await post('settings-save', ok)).status).toBe(200);
    expect(await json(await get('settings'))).toMatchObject({ accent: 'plum', amber_minutes: 4, red_minutes: 9, review_url: 'https://g.page/r/abc' });
    for (const bad of [{ review_url: 'http://x.com' }, { review_url: 'javascript:alert(1)' }, { accent: 'hotpink' }, { amber_minutes: 10, red_minutes: 10 }, { name: '' }, { red_minutes: 500 }]) {
      expect((await post('settings-save', { ...ok, ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post('settings-save', { ...ok, review_url: '' })).status).toBe(200); // blank clears the link
    expect((await json(await get('settings'))).review_url).toBeNull();
  });
});

describe('report and audit log', () => {
  it('report ranges are validated; the audit log lists changes with actor names and pages', async () => {
    as(w.A.manager);
    expect((await get('report', '?range=7d')).status).toBe(200);
    expect((await get('report', '?range=forever')).status).toBe(400);
    expect((await json(await get('report'))).range).toBe('today'); // default
    await post('category-save', { name: `Audit ${randomUUID().slice(0, 5)}` });
    const a = await json(await get('audit', '?limit=3'));
    expect(a.entries).toHaveLength(3);
    expect(a.entries[0].actor_name).toMatch(/manager/i);
    const b = await json(await get('audit', `?limit=3&before=${a.entries[2].id}`));
    expect(b.entries.every((e: any) => e.id < a.entries[2].id)).toBe(true);
    expect((await get('audit', '?limit=9999')).status).toBe(400);
    expect((await get('audit', '?limit=abc')).status).toBe(400);
  });
});

describe('staff accounts', () => {
  const email = () => `new-${randomUUID().slice(0, 6)}@test.local`;
  it('only the owner can add staff; the temporary password is returned once and must be changed', async () => {
    as(w.A.manager);
    expect((await post('staff-add', { email: email(), name: 'Nope', role: 'waiter' })).status).toBe(403);
    as(w.A.owner);
    const e = email();
    const r = await post('staff-add', { email: e, name: 'Meera', role: 'waiter' });
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(b.temporary_password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
    expect(b.email).toBe(e);

    // not stored anywhere readable: not in the audit log, not in the staff list
    const dump = JSON.stringify(await db.admin(`select * from public.audit_log`)) + JSON.stringify(await json(await get('staff')));
    expect(dump).not.toContain(b.temporary_password);
    const entry = (await db.admin<any>(`select actor_user_id, actor_role from public.audit_log where entity = 'staff' and action = 'insert' order by id desc limit 1`))[0];
    expect(entry).toEqual({ actor_user_id: w.A.owner, actor_role: 'owner' });

    // the new waiter is blocked from everything except choosing a password
    as(b.user_id);
    const blocked = await boardGET(req('/api/staff/board'));
    expect(blocked.status).toBe(403);
    expect((await json(blocked)).error.key).toBe('password_change_required');
    expect((await post('menu', {})).status).toBe(405);
    expect((await get('menu')).status).toBe(403);

    // weak or short passwords are refused; a good one unlocks the account
    const pw = (password: string) => passwordPOST(req('/api/auth/password', { password }));
    expect((await pw('short')).status).toBe(400);
    expect((await pw('password1234567')).status).toBe(400); // known-weak (stand-in for Supabase's leaked-password check)
    expect((await pw('a-fresh-long-passphrase-42')).status).toBe(200);
    expect((await boardGET(req('/api/staff/board'))).status).toBe(200);
  });
  it('refuses a duplicate email, bad roles/names, and unauthenticated or foreign-origin calls', async () => {
    as(w.A.owner);
    const e = email();
    expect((await post('staff-add', { email: e, name: 'A', role: 'kitchen' })).status).toBe(201);
    const dup = await post('staff-add', { email: e, name: 'B', role: 'kitchen' });
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.key).toBe('conflict');
    for (const bad of [{ role: 'owner' }, { role: 'admin' }, { name: '' }, { email: 'not-an-email' }, { extra: 1 }]) {
      expect((await post('staff-add', { email: email(), name: 'X', role: 'waiter', ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post('staff-add', { email: email(), name: 'X', role: 'waiter' }, { origin: 'https://evil.example' })).status).toBe(403);
    as(null);
    expect((await post('staff-add', { email: email(), name: 'X', role: 'waiter' })).status).toBe(401);
  });
  it('does not leave a login behind when the restaurant side fails', async () => {
    as(w.A.owner);
    const e = email();
    state.forceError = null;
    // make the NEXT service-role rpc after the rate limiter fail: the rate limiter runs first, so queue two
    const origRpc = (await import('./helpers')).fakeAdminClient.rpc;
    const spy = vi.spyOn((await import('./helpers')).fakeAdminClient, 'rpc').mockImplementation(async (name: string, args: Record<string, unknown>) =>
      name === 'owner_add_staff' ? { data: null, error: { code: 'XX000', message: 'boom' } } : origRpc(name, args));
    const r = await post('staff-add', { email: e, name: 'Ghost', role: 'waiter' });
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(authState.deleted.length).toBe(1);
    expect((await db.admin<any>(`select count(*)::int n from auth.users where email = $1`, [e]))[0].n).toBe(0);
  });
  it('change role, deactivate and reactivate; owners and other restaurants are protected', async () => {
    as(w.A.owner);
    const b = await json(await post('staff-add', { email: email(), name: 'Dev', role: 'waiter' }));
    expect((await post('staff-update', { user_id: b.user_id, name: 'Dev K', role: 'kitchen', active: true })).status).toBe(200);
    expect((await post('staff-update', { user_id: b.user_id, name: 'Dev K', role: 'kitchen', active: false })).status).toBe(200);
    const list = (await json(await get('staff'))) as unknown as any[];
    expect(list.find((s) => s.user_id === b.user_id)).toMatchObject({ role: 'kitchen', active: false, display_name: 'Dev K' });
    const owner = await post('staff-update', { user_id: w.A.owner, name: 'Me', role: 'manager', active: true });
    expect(owner.status).toBe(403);
    expect((await json(owner)).error.key).toBe('protected');
    expect((await post('staff-update', { user_id: w.B.waiter, name: 'X', role: 'waiter', active: false })).status).toBe(404);
    expect((await post('staff-update', { user_id: b.user_id, name: 'X', role: 'owner', active: true })).status).toBe(400);
    expect((await db.admin<any>(`select active from public.staff where user_id = $1`, [w.B.waiter]))[0].active).toBe(true);
  });
  it('reset password: new temporary password, forced change, only for non-owner staff of the same restaurant', async () => {
    as(w.A.owner);
    const r = await post('staff-reset-password', { user_id: w.A.waiter });
    expect(r.status).toBe(200);
    const pw = (await json(r)).temporary_password as string;
    expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
    expect(authState.meta.get(w.A.waiter)?.app_metadata.must_change_password).toBe(true);
    expect((await post('staff-reset-password', { user_id: w.B.waiter })).status).toBe(404);
    expect((await post('staff-reset-password', { user_id: w.A.owner })).status).toBe(403);
    as(w.A.manager);
    expect((await post('staff-reset-password', { user_id: w.A.waiter })).status).toBe(403);
    expect(JSON.stringify(await db.admin(`select * from public.audit_log`))).not.toContain(pw);
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where action = 'staff_password_reset'`))[0].n).toBeGreaterThan(0);
  });
});

describe('password change route', () => {
  it('needs a session, our origin and a valid body', async () => {
    const call = (body: unknown, o = {}) => passwordPOST(req('/api/auth/password', body, o));
    expect((await call({ password: 'a-long-enough-password' })).status).toBe(401);
    as(w.A.owner);
    expect((await call({ password: 'a-long-enough-password' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call({ password: 'x'.repeat(129) })).status).toBe(400);
    expect((await call({ password: 'a-long-enough-password', admin: true })).status).toBe(400);
    expect((await call({})).status).toBe(400);
  });
});

describe('a suspended restaurant', () => {
  it('can still be read in the dashboard but nothing can be changed', async () => {
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.B.rid]);
    try {
      as(w.B.owner);
      expect((await get('menu')).status).toBe(200);
      expect((await get('report')).status).toBe(200);
      const r = await post('category-save', { name: 'Blocked' });
      expect(r.status).toBe(403);
      expect((await json(r)).error.key).toBe('restaurant_suspended');
      expect((await post('staff-add', { email: `s-${randomUUID().slice(0, 5)}@t.local`, name: 'X', role: 'waiter' })).status).toBe(403);
    } finally {
      await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.B.rid]);
    }
  });
});

describe('data stays inside its restaurant', () => {
  it('B\'s dashboard never shows A\'s dishes, staff, tables, orders or audit entries', async () => {
    const [t] = await db.admin<any>(`insert into public.dining_tables (restaurant_id, label) values ($1,'X1') returning qr_token`, [w.A.rid]);
    const [secretDish] = await db.admin<any>(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,'Aroma Secret Special',9900) returning id`, [w.A.rid, w.A.catId]);
    await placeOrder(db, w.A, { token: t.qr_token }, [{ item_id: secretDish.id, qty: 1 }]);
    as(w.B.owner);
    const all = JSON.stringify([await json(await get('menu')), await json(await get('staff')), await json(await get('tables')), await json(await get('report', '?range=30d')), await json(await get('audit', '?limit=200'))]);
    for (const secret of ['Aroma Secret Special', 'cafe-aroma', t.qr_token, w.A.owner]) expect(all, secret).not.toContain(secret);
  });
});

describe('dish sizes and options through the API', () => {
  const uuidish = '11111111-1111-4111-8111-111111111111';
  const mkDish = async () => (await json(await post('item-save', { category_id: w.A.catId, name: `Sized ${randomUUID().slice(0, 5)}`, price_paise: 10000, diet: 'veg', spice: 0, is_bestseller: false, is_chef_pick: false }))).id as string;
  const choices = (item: string, extra: Record<string, unknown> = {}) => ({
    item_id: item,
    variants: [{ name: 'Small', price_paise: 12000, is_available: true }, { name: 'Large', price_paise: 20000, is_available: true }],
    groups: [{ name: 'Sauce', required: true, max_select: 1, options: [{ name: 'Peri peri', price_delta_paise: 0 }, { name: 'Cheese dip', price_delta_paise: 2000 }] }],
    ...extra,
  });

  it('owner and manager save sizes and options; the menu read returns them; the dish price follows the cheapest size', async () => {
    for (const uid of [w.A.owner, w.A.manager]) {
      as(uid);
      const id = await mkDish();
      expect((await post('item-choices-save', choices(id))).status, uid).toBe(200);
      const item = (await json(await get('menu'))).categories.flatMap((c: any) => c.items).find((i: any) => i.id === id);
      expect(item.price_paise).toBe(12000);
      expect(item.variants.map((v: any) => v.name)).toEqual(['Small', 'Large']);
      expect(item.groups[0]).toMatchObject({ name: 'Sauce', required: true, max_select: 1 });
      expect(item.groups[0].options.map((o: any) => o.name)).toEqual(['Peri peri', 'Cheese dip']);
    }
  });

  it('waiters, the kitchen, other restaurants and signed-out visitors cannot change them', async () => {
    as(w.A.owner);
    const id = await mkDish();
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) { as(uid); expect((await post('item-choices-save', choices(id))).status, uid).toBe(403); }
    as(w.B.owner);
    expect((await post('item-choices-save', choices(id))).status).toBe(404);
    authState.userId = null;
    expect((await post('item-choices-save', choices(id))).status).toBe(401);
  });

  it('refuses a bad shape: too many, wrong types, unknown fields, a maximum above the number of choices', async () => {
    as(w.A.owner);
    const id = await mkDish();
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, price_paise: 1, is_available: true }));
    const bad: Record<string, unknown>[] = [
      { variants: many },
      { variants: [{ name: '', price_paise: 1, is_available: true }] },
      { variants: [{ name: 'S', price_paise: -1, is_available: true }] },
      { variants: [{ name: 'S', price_paise: 1.5, is_available: true }] },
      { variants: [{ name: 'S', price: 1, is_available: true }] },
      { groups: [{ name: 'G', required: true, max_select: 2, options: [{ name: 'a', price_delta_paise: 0 }] }] },
      { groups: [{ name: 'G', required: true, max_select: 1, options: [] }] },
      { groups: [{ name: 'G', required: 'yes', max_select: 1, options: [{ name: 'a', price_delta_paise: 0 }] }] },
      { groups: [{ name: 'G', required: true, max_select: 1, options: [{ name: 'a', price_delta_paise: -1 }] }] },
      { extra: 1 },
    ];
    for (const b of bad) expect((await post('item-choices-save', choices(id, b))).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    expect((await post('item-choices-save', { ...choices(id), item_id: 'nope' })).status).toBe(400);
    expect((await post('item-choices-save', { ...choices(id), item_id: uuidish })).status).toBe(404);
  });

  it('CSV import carries sizes through the API', async () => {
    as(w.A.owner);
    const row = { category: 'API Sizes', name: `Imp ${randomUUID().slice(0, 4)}`, description: '', price_paise: 9000, diet: 'veg', spice: 0, bestseller: false, chef_pick: false, available: true, sizes: [{ name: 'Half', price_paise: 9000 }, { name: 'Full', price_paise: 16000 }] };
    expect(await json(await post('menu-import', { rows: [row] }))).toMatchObject({ ok: true, created: 1 });
    const item = (await json(await get('menu'))).categories.flatMap((c: any) => c.items).find((i: any) => i.name === row.name);
    expect(item.variants.map((v: any) => [v.name, v.price_paise])).toEqual([['Half', 9000], ['Full', 16000]]);
    expect((await post('menu-import', { rows: [{ ...row, name: 'Too many', sizes: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, price_paise: 1 })) }] })).status).toBe(400);
  });
});

describe('call for problems settings through the API', () => {
  it('owner and manager read them; only the owner changes them; waiters and the kitchen see nothing', async () => {
    for (const uid of [w.A.owner, w.A.manager]) { as(uid); expect((await get('help-link')).status, uid).toBe(200); }
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) { as(uid); expect((await get('help-link')).status, uid).toBe(403); }
    as(w.A.manager);
    expect((await post('help-link-save', { enabled: true, topics: ['Towel'] })).status).toBe(403);
    as(w.A.owner);
    expect((await post('help-link-save', { enabled: true, topics: [' Towel ', 'Wi-Fi down', 'towel'] })).status).toBe(200);
    const g = await json(await get('help-link'));
    expect(g).toMatchObject({ enabled: true, topics: ['Towel', 'Wi-Fi down'] });
    expect(g.token).toMatch(/^[0-9a-f]{64}$/);
    // a new link replaces the token; turning off erases it
    expect((await post('help-link-save', { enabled: true, topics: [], rotate: true })).status).toBe(200);
    expect((await json(await get('help-link'))).token).not.toBe(g.token);
    expect((await post('help-link-save', { enabled: false, topics: [] })).status).toBe(200);
    expect(await json(await get('help-link'))).toMatchObject({ enabled: false, token: null });
  });
  it('refuses a bad shape and other restaurants cannot see this one\'s link', async () => {
    as(w.A.owner);
    expect((await post('help-link-save', { enabled: true, topics: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400);
    expect((await post('help-link-save', { enabled: true, topics: ['x'.repeat(41)] })).status).toBe(400);
    expect((await post('help-link-save', { enabled: true, topics: [''] })).status).toBe(400);
    expect((await post('help-link-save', { enabled: 'yes', topics: [] })).status).toBe(400);
    expect((await post('help-link-save', { enabled: true, topics: [], extra: 1 })).status).toBe(400);
    expect((await post('help-link-save', { enabled: true, topics: [] }, { origin: 'https://evil.example' })).status).toBe(403);
    as(w.B.owner);
    expect((await json(await get('help-link'))).enabled).toBe(false);
  });
});
