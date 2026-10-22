import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());

const call = async <T = any>(uid: string, fn: string, args: unknown[] = []): Promise<T> =>
  (await db.as('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const err = (uid: string, fn: string, args: unknown[] = []) =>
  db.asErr('authenticated', uid, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const svc = async <T = any>(fn: string, args: unknown[]): Promise<T> =>
  (await db.as('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const svcErr = (fn: string, args: unknown[]) => db.asErr('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);

const saveItem = (uid: string, over: Record<string, unknown> = {}) => {
  const a = { id: null, category: w.A.catId, name: `Dish ${randomUUID().slice(0, 6)}`, description: 'Tasty', price: 15000, diet: 'veg', spice: 1, image: null, best: false, chef: false, avail: true, ...over };
  return call<string>(uid, 'mgr_save_item', [a.id, a.category, a.name, a.description, a.price, a.diet, a.spice, a.image, a.best, a.chef, a.avail]);
};
const saveItemErr = (uid: string, over: Record<string, unknown> = {}) => {
  const a = { id: null, category: w.A.catId, name: `Dish ${randomUUID().slice(0, 6)}`, description: 'Tasty', price: 15000, diet: 'veg', spice: 1, image: null, best: false, chef: false, avail: true, ...over };
  return err(uid, 'mgr_save_item', [a.id, a.category, a.name, a.description, a.price, a.diet, a.spice, a.image, a.best, a.chef, a.avail]);
};
const item = async (id: string) => (await db.admin<any>(`select * from public.items where id = $1`, [id]))[0];
const audit = (rid: string, where = '') => db.admin<any>(`select action, entity, actor_user_id, actor_role, details from public.audit_log where restaurant_id = $1 ${where} order by id`, [rid]);

describe('who may use the dashboard functions', () => {
  const readers = ['mgr_get_menu', 'mgr_get_settings', 'mgr_get_staff', 'mgr_get_audit'];
  it('owner and manager may read; waiter, kitchen, strangers, anon and service_role may not', async () => {
    for (const fn of readers) {
      expect(await err(w.A.owner, fn), fn).toBeNull();
      expect(await err(w.A.manager, fn), fn).toBeNull();
      for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await err(uid, fn))?.code, `${fn} ${uid}`).toBe('GM011');
      expect((await db.asErr('anon', null, `select public.${fn}()`))?.code).toBe('42501');
      expect((await db.asErr('service_role', null, `select public.${fn}()`))?.code).toBe('42501');
    }
    expect(await err(w.A.owner, 'mgr_report', ['7d'])).toBeNull();
    expect((await err(w.A.waiter, 'mgr_report', ['7d']))?.code).toBe('GM011');
  });
  it('waiters and the kitchen cannot write anything', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen]) {
      expect((await err(uid, 'mgr_save_category', [null, 'Hack', true]))?.code).toBe('GM011');
      expect((await saveItemErr(uid))?.code).toBe('GM011');
      expect((await err(uid, 'mgr_bulk_price', [[w.A.chai], 'set', 1]))?.code).toBe('GM011');
      expect((await err(uid, 'mgr_import_items', [JSON.stringify([{}])]))?.code).toBe('GM011');
      expect((await err(uid, 'mgr_save_table', [w.A.t1.id, 'X', true]))?.code).toBe('GM011');
    }
  });
  it('a manager can edit the menu but not settings; only the owner changes settings', async () => {
    expect(await saveItemErr(w.A.manager)).toBeNull();
    expect((await err(w.A.manager, 'mgr_update_settings', ['Cafe', null, 'teal', 5, 10]))?.code).toBe('GM011');
    expect(await err(w.A.owner, 'mgr_update_settings', ['Cafe Aroma', null, 'teal', 5, 10])).toBeNull();
  });
  it('a suspended restaurant can still be read but nothing can be changed', async () => {
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect(await err(w.A.owner, 'mgr_get_menu')).toBeNull();
    expect(await err(w.A.owner, 'mgr_report', ['today'])).toBeNull();
    expect((await saveItemErr(w.A.owner))?.code).toBe('GM001');
    expect((await err(w.A.owner, 'mgr_save_category', [null, 'Nope', true]))?.code).toBe('GM001');
    expect((await err(w.A.owner, 'mgr_update_settings', ['X', null, 'teal', 5, 10]))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
  });
});

describe('categories', () => {
  it('create, rename, deactivate; names are unique per restaurant ignoring case', async () => {
    const id = await call<string>(w.A.manager, 'mgr_save_category', [null, 'Soups', true]);
    expect(await err(w.A.manager, 'mgr_save_category', [null, 'soups', true])).toMatchObject({ code: 'GM019' });
    await call(w.A.manager, 'mgr_save_category', [id, 'Hot Soups', false]);
    const [c] = await db.admin<any>(`select name_en, active from public.categories where id = $1`, [id]);
    expect(c).toEqual({ name_en: 'Hot Soups', active: false });
    expect((await err(w.A.manager, 'mgr_save_category', [null, '', true]))?.code).toBe('GM015');
    expect((await err(w.A.manager, 'mgr_save_category', [null, 'x'.repeat(61), true]))?.code).toBe('GM015');
    // the same name is fine in another restaurant
    expect(await err(w.B.owner, 'mgr_save_category', [null, 'Hot Soups', true])).toBeNull();
  });
  it('cannot delete a category that still has dishes; an empty one can be deleted', async () => {
    expect((await err(w.A.owner, 'mgr_delete_category', [w.A.catId]))?.code).toBe('GM018');
    const id = await call<string>(w.A.owner, 'mgr_save_category', [null, 'Temp', true]);
    expect(await err(w.A.owner, 'mgr_delete_category', [id])).toBeNull();
    expect((await err(w.A.owner, 'mgr_delete_category', [id]))?.code).toBe('GM012');
  });
  it('reorders; reordering is not written to the audit log', async () => {
    const a = await call<string>(w.A.owner, 'mgr_save_category', [null, 'Ord A', true]);
    const b = await call<string>(w.A.owner, 'mgr_save_category', [null, 'Ord B', true]);
    const before = (await audit(w.A.rid)).length;
    await call(w.A.owner, 'mgr_reorder_categories', [[b, a]]);
    const rows = await db.admin<any>(`select id, sort_order from public.categories where id in ($1,$2)`, [a, b]);
    expect(rows.find((r: any) => r.id === b).sort_order).toBeLessThan(rows.find((r: any) => r.id === a).sort_order);
    expect((await audit(w.A.rid)).length).toBe(before);
    expect((await err(w.A.owner, 'mgr_reorder_categories', [[randomUUID()]]))?.code).toBe('GM012');
    expect((await err(w.A.owner, 'mgr_reorder_categories', [[]]))?.code).toBe('GM015');
  });
  it('one restaurant can never touch another\'s categories', async () => {
    expect((await err(w.B.owner, 'mgr_delete_category', [w.A.catId]))?.code).toBe('GM012');
    expect((await err(w.B.owner, 'mgr_save_category', [w.A.catId, 'Hijack', true]))?.code).toBe('GM012');
    expect((await err(w.B.owner, 'mgr_reorder_categories', [[w.A.catId]]))?.code).toBe('GM012');
    const [c] = await db.admin<any>(`select name_en from public.categories where id = $1`, [w.A.catId]);
    expect(c.name_en).toBe('Mains');
  });
});

describe('items', () => {
  it('create and update with every field; the new dish shows up for guests', async () => {
    const id = await saveItem(w.A.manager, { name: 'Veg Thali', description: 'Full meal', price: 18000, diet: 'jain', spice: 2, best: true, chef: true });
    expect(await item(id)).toMatchObject({ name_en: 'Veg Thali', price_paise: 18000, diet: 'jain', spice: 2, is_bestseller: true, is_chef_pick: true, is_available: true });
    await saveItem(w.A.manager, { id, name: 'Veg Thali', price: 19000, diet: 'veg', spice: 0, avail: false });
    expect(await item(id)).toMatchObject({ price_paise: 19000, diet: 'veg', spice: 0, is_available: false });
    const t = (await db.admin<any>(`insert into public.dining_tables (restaurant_id, label) values ($1,'M1') returning qr_token`, [w.A.rid]))[0];
    const menu = (await db.as<any>('service_role', null, `select public.guest_get_menu($1,$2) m`, [w.A.slug, t.qr_token]))[0].m;
    expect(menu.categories.flatMap((c: any) => c.items).find((i: any) => i.id === id)).toMatchObject({ price_paise: 19000, is_available: false });
  });
  it('rejects bad input with a friendly error, not a raw constraint failure', async () => {
    const bad: Record<string, unknown>[] = [
      { name: '' }, { name: 'x'.repeat(81) }, { price: -1 }, { price: 10000001 }, { diet: 'beef' }, { spice: 4 }, { spice: -1 },
      { description: 'x'.repeat(301) }, { image: `${w.B.rid}/steal.webp` }, { image: `${w.A.rid}/../x.webp` }, { image: 'nofolder.webp' },
    ];
    for (const b of bad) expect((await saveItemErr(w.A.owner, b))?.code, JSON.stringify(b)).toBe('GM015');
    expect(await saveItemErr(w.A.owner, { image: `${w.A.rid}/${randomUUID()}.webp` })).toBeNull();
  });
  it('same dish name in one category is a conflict (ignoring case); fine in another category', async () => {
    const name = `Unique ${randomUUID().slice(0, 6)}`;
    await saveItem(w.A.owner, { name });
    expect((await saveItemErr(w.A.owner, { name: name.toUpperCase() }))?.code).toBe('GM019');
    const cat = await call<string>(w.A.owner, 'mgr_save_category', [null, `Other ${randomUUID().slice(0, 5)}`, true]);
    expect(await saveItemErr(w.A.owner, { name, category: cat })).toBeNull();
  });
  it('cannot put a dish into another restaurant\'s category or edit/delete/duplicate their dishes', async () => {
    expect((await saveItemErr(w.B.owner, { category: w.A.catId }))?.code).toBe('GM012');
    expect((await saveItemErr(w.B.owner, { id: w.A.paneer, category: w.B.catId, name: 'Hijack' }))?.code).toBe('GM012');
    expect((await err(w.B.owner, 'mgr_delete_item', [w.A.paneer]))?.code).toBe('GM012');
    expect((await err(w.B.owner, 'mgr_duplicate_item', [w.A.paneer]))?.code).toBe('GM012');
    expect((await item(w.A.paneer)).name_en).toBe('Paneer Butter Masala');
  });
  it('duplicate makes a copy with a unique name; delete removes it but keeps past orders readable', async () => {
    const id = await saveItem(w.A.owner, { name: 'Dup Source' });
    const c1 = await call<string>(w.A.owner, 'mgr_duplicate_item', [id]);
    const c2 = await call<string>(w.A.owner, 'mgr_duplicate_item', [id]);
    expect((await item(c1)).name_en).toBe('Dup Source (copy)');
    expect((await item(c2)).name_en).toBe('Dup Source (copy 2)');
    expect(await item(c1)).toMatchObject({ price_paise: 15000, category_id: w.A.catId });
    // an order that used a dish keeps its snapshot after the dish is deleted
    const [t] = await db.admin<any>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning qr_token`, [w.A.rid, `D${randomUUID().slice(0, 5)}`]);
    const o = await placeOrder(db, w.A, { token: t.qr_token }, [{ item_id: id, qty: 1 }]);
    await call(w.A.owner, 'mgr_delete_item', [id]);
    expect(await item(id)).toBeUndefined();
    const [line] = await db.admin<any>(`select item_id, name_en_snapshot from public.order_items where order_id = $1`, [o.order_id]);
    expect(line).toEqual({ item_id: null, name_en_snapshot: 'Dup Source' });
  });
  it('reorders dishes within a category', async () => {
    const cat = await call<string>(w.A.owner, 'mgr_save_category', [null, `Reo ${randomUUID().slice(0, 5)}`, true]);
    const ids = [await saveItem(w.A.owner, { category: cat, name: 'R1' }), await saveItem(w.A.owner, { category: cat, name: 'R2' }), await saveItem(w.A.owner, { category: cat, name: 'R3' })];
    await call(w.A.owner, 'mgr_reorder_items', [cat, [ids[2], ids[0], ids[1]]]);
    const menu = await call<any>(w.A.owner, 'mgr_get_menu');
    expect(menu.categories.find((c: any) => c.id === cat).items.map((i: any) => i.name)).toEqual(['R3', 'R1', 'R2']);
    expect((await err(w.A.owner, 'mgr_reorder_items', [cat, [w.A.paneer]]))?.code).toBe('GM012'); // belongs to another category
  });
  it('price changes are audited with old and new value and who made them', async () => {
    const id = await saveItem(w.A.manager, { name: 'Audit Dish', price: 10000 });
    await saveItem(w.A.manager, { id, name: 'Audit Dish', price: 12500 });
    const log = (await audit(w.A.rid, `and entity = 'items' and action = 'update'`)).filter((r: any) => r.details.price_paise);
    const last = log[log.length - 1];
    expect(last.details.price_paise).toEqual({ old: 10000, new: 12500 });
    expect(last).toMatchObject({ actor_user_id: w.A.manager, actor_role: 'manager' });
  });
});

describe('bulk price edit', () => {
  const mk = async (prices: number[]) => {
    const cat = await call<string>(w.A.owner, 'mgr_save_category', [null, `Bulk ${randomUUID().slice(0, 5)}`, true]);
    return Promise.all(prices.map((p, i) => saveItem(w.A.owner, { category: cat, name: `B${i}`, price: p })));
  };
  const prices = async (ids: string[]) => (await db.admin<any>(`select price_paise from public.items where id = any($1::uuid[]) order by name_en`, [ids])).map((r: any) => r.price_paise);
  it('percent, add and set modes (rounded to whole paise)', async () => {
    const ids = await mk([10000, 12345, 999]);
    expect(await call(w.A.manager, 'mgr_bulk_price', [ids, 'percent', 10])).toBe(3);
    expect(await prices(ids)).toEqual([11000, 13580, 1099]); // 12345*1.1 = 13579.5 -> 13580 ; 999*1.1=1098.9 -> 1099
    await call(w.A.manager, 'mgr_bulk_price', [ids, 'add', -500]);
    expect(await prices(ids)).toEqual([10500, 13080, 599]);
    await call(w.A.manager, 'mgr_bulk_price', [ids, 'set', 20000]);
    expect(await prices(ids)).toEqual([20000, 20000, 20000]);
    await call(w.A.manager, 'mgr_bulk_price', [ids, 'percent', -50]);
    expect(await prices(ids)).toEqual([10000, 10000, 10000]);
  });
  it('rejects results outside 0 .. Rs 1,00,000 and changes nothing', async () => {
    const ids = await mk([5000, 6000]);
    expect((await err(w.A.owner, 'mgr_bulk_price', [ids, 'add', -5500]))?.code).toBe('GM015'); // would make one negative
    expect((await err(w.A.owner, 'mgr_bulk_price', [ids, 'percent', 1000000]))?.code).toBe('GM015'); // +1,000,000% would exceed the maximum price
    expect((await err(w.A.owner, 'mgr_bulk_price', [ids, 'percent', -101]))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_bulk_price', [ids, 'multiply', 2]))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_bulk_price', [[], 'set', 1]))?.code).toBe('GM015');
    expect(await prices(ids)).toEqual([5000, 6000]);
  });
  it('foreign dishes make the whole call fail untouched', async () => {
    const ids = await mk([5000]);
    expect((await err(w.A.owner, 'mgr_bulk_price', [[...ids, w.B.paneer], 'set', 1]))?.code).toBe('GM012');
    expect(await prices(ids)).toEqual([5000]);
    expect((await item(w.B.paneer)).price_paise).toBe(25000);
  });
});

describe('CSV import', () => {
  const row = (o: Record<string, unknown> = {}) => ({ category: 'Imports', name: `Imp ${randomUUID().slice(0, 6)}`, description: 'd', price_paise: 12000, diet: 'veg', spice: 1, bestseller: false, chef_pick: false, available: true, ...o });
  const imp = (uid: string, rows: unknown[]) => call<any>(uid, 'mgr_import_items', [JSON.stringify(rows)]);

  it('creates categories and dishes, updates existing dishes by name, and reports counts', async () => {
    const a = row({ name: 'Imp Alpha' });
    const r1 = await imp(w.A.manager, [a, row({ name: 'Imp Beta', category: 'Brand New Cat', diet: 'nonveg', spice: 3, bestseller: true })]);
    expect(r1).toEqual({ ok: true, created: 2, updated: 0, categories_created: 2 });
    const r2 = await imp(w.A.manager, [{ ...a, price_paise: 99900, description: 'new text' }]);
    expect(r2).toEqual({ ok: true, created: 0, updated: 1, categories_created: 0 });
    const [i] = await db.admin<any>(`select price_paise, description_en from public.items where name_en = 'Imp Alpha' and restaurant_id = $1`, [w.A.rid]);
    expect(i).toEqual({ price_paise: 99900, description_en: 'new text' });
    expect((await audit(w.A.rid, `and action = 'menu_import'`)).length).toBe(2);
  });
  it('is all-or-nothing: one bad row stops everything and the errors name the rows', async () => {
    const before = (await db.admin<any>(`select count(*)::int n from public.items where restaurant_id = $1`, [w.A.rid]))[0].n;
    const r = await imp(w.A.owner, [row({ name: 'OK one' }), row({ diet: 'beef' }), row({ price_paise: -5 }), row({ name: '' }), row({ spice: 9 })]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e: any) => e.row)).toEqual([2, 3, 4, 5]);
    expect(r.errors[0].message).toMatch(/Diet/);
    expect((await db.admin<any>(`select count(*)::int n from public.items where restaurant_id = $1`, [w.A.rid]))[0].n).toBe(before);
    expect((await db.admin<any>(`select count(*)::int n from public.items where name_en = 'OK one'`))[0].n).toBe(0);
  });
  it('flags a dish listed twice in the file, and over-long or malformed rows', async () => {
    const r = await imp(w.A.owner, [row({ name: 'Twice' }), row({ name: 'twice' }), row({ description: 'x'.repeat(301) }), { category: 'C', name: 'N', price_paise: 'abc', diet: 'veg', spice: 0 }]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e: any) => e.row)).toEqual([2, 3, 4]);
  });
  it('limits size (1..500 rows) and checks permissions and tenancy', async () => {
    expect((await err(w.A.owner, 'mgr_import_items', ['[]']))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_import_items', [JSON.stringify(Array.from({ length: 501 }, () => row()))]))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_import_items', ['{"a":1}']))?.code).toBe('GM015');
    expect((await err(w.A.kitchen, 'mgr_import_items', [JSON.stringify([row()])]))?.code).toBe('GM011');
    const mine = row({ name: 'Tenant Check', category: 'Tenancy' });
    await imp(w.B.owner, [mine]);
    expect((await db.admin<any>(`select count(*)::int n from public.items where name_en = 'Tenant Check' and restaurant_id = $1`, [w.A.rid]))[0].n).toBe(0);
  });
});

describe('tables', () => {
  it('rename and deactivate; labels are unique; a deactivated table refuses guest orders', async () => {
    const [t] = await db.admin<any>(`insert into public.dining_tables (restaurant_id, label) values ($1,'TT1') returning id, qr_token`, [w.A.rid]);
    await db.admin(`insert into public.dining_tables (restaurant_id, label) values ($1,'TT2')`, [w.A.rid]);
    expect((await err(w.A.manager, 'mgr_save_table', [t.id, 'TT2', true]))?.code).toBe('GM019');
    expect(await err(w.A.manager, 'mgr_save_table', [t.id, 'Window 1', true])).toBeNull();
    await call(w.A.manager, 'mgr_save_table', [t.id, 'Window 1', false]);
    const o = await db.asErr('service_role', null, `select public.guest_place_order($1,$2,$3::jsonb,null,$4,null)`, [w.A.slug, t.qr_token, JSON.stringify([{ item_id: w.A.chai, qty: 1 }]), randomUUID()]);
    expect(o?.code).toBe('GM002');
    expect((await err(w.A.manager, 'mgr_save_table', [t.id, '', true]))?.code).toBe('GM015');
    expect((await err(w.B.owner, 'mgr_save_table', [t.id, 'Hijack', true]))?.code).toBe('GM012');
  });
});

describe('settings', () => {
  it('owner updates name, review link, colour and waiting limits; guests and staff screens see them', async () => {
    await call(w.A.owner, 'mgr_update_settings', ['Cafe Aroma Deluxe', 'https://g.page/r/new', 'indigo', 3, 8]);
    const s = await call<any>(w.A.manager, 'mgr_get_settings');
    expect(s).toMatchObject({ name: 'Cafe Aroma Deluxe', review_url: 'https://g.page/r/new', accent: 'indigo', amber_minutes: 3, red_minutes: 8, role: 'manager', slug: 'cafe-aroma' });
    const me = (await db.as<any>('authenticated', w.A.waiter, `select public.staff_me() r`))[0].r;
    expect(me.restaurant).toMatchObject({ name: 'Cafe Aroma Deluxe', accent: 'indigo', amber_minutes: 3, red_minutes: 8 });
    const entry = (await audit(w.A.rid, `and entity = 'restaurants' and action = 'update'`)).pop();
    expect(entry.details.accent).toEqual({ old: 'teal', new: 'indigo' });
    expect(entry).toMatchObject({ actor_user_id: w.A.owner, actor_role: 'owner' });
  });
  it('validates every field (https only link, palette colours, red later than amber)', async () => {
    const bad: unknown[][] = [
      ['', null, 'teal', 5, 10], ['x'.repeat(81), null, 'teal', 5, 10], ['N', 'http://x.com', 'teal', 5, 10], ['N', 'javascript:alert(1)', 'teal', 5, 10],
      ['N', 'https://a b', 'teal', 5, 10], ['N', null, 'hotpink', 5, 10], ['N', null, 'teal', 0, 10], ['N', null, 'teal', 10, 10], ['N', null, 'teal', 10, 5], ['N', null, 'teal', 5, 241],
    ];
    for (const b of bad) expect((await err(w.A.owner, 'mgr_update_settings', b))?.code, JSON.stringify(b)).toBe('GM015');
    expect(await err(w.A.owner, 'mgr_update_settings', ['N', '', 'teal', 5, 10])).toBeNull(); // empty link clears it
    expect((await call<any>(w.A.owner, 'mgr_get_settings')).review_url).toBeNull();
  });
});

describe('staff accounts', () => {
  const newUser = async (email: string) => {
    const [u] = await db.admin<any>(`insert into auth.users (email) values ($1) returning id`, [email]);
    return u.id as string;
  };
  it('lists everyone in the restaurant with their email; managers can see but not change', async () => {
    const list = await call<any[]>(w.A.manager, 'mgr_get_staff');
    expect(list.map((s) => s.role)).toEqual(['owner', 'manager', 'waiter', 'kitchen']);
    expect(list.find((s) => s.role === 'owner').email).toMatch(/cafe-aroma-owner/);
    expect(list.find((s) => s.role === 'manager').is_you).toBe(true);
    expect(JSON.stringify(list)).not.toContain('spice-garden');
  });
  it('only the owner (checked inside the database) can add staff; roles are limited; duplicates are refused', async () => {
    const u = await newUser(`new1-${randomUUID().slice(0, 5)}@test.local`);
    expect((await svcErr('owner_add_staff', [w.A.manager, u, 'waiter', 'Sam']))?.code).toBe('GM011');
    expect((await svcErr('owner_add_staff', [w.A.waiter, u, 'waiter', 'Sam']))?.code).toBe('GM011');
    expect((await svcErr('owner_add_staff', [randomUUID(), u, 'waiter', 'Sam']))?.code).toBe('GM011');
    expect((await svcErr('owner_add_staff', [w.A.owner, u, 'owner', 'Sam']))?.code).toBe('GM015');
    expect((await svcErr('owner_add_staff', [w.A.owner, u, 'admin', 'Sam']))?.code).toBe('GM015');
    expect((await svcErr('owner_add_staff', [w.A.owner, u, 'waiter', '']))?.code).toBe('GM015');
    expect(await svc('owner_add_staff', [w.A.owner, u, 'waiter', 'Sam'])).toBe(u);
    expect((await svcErr('owner_add_staff', [w.A.owner, u, 'kitchen', 'Sam again']))?.code).toBe('GM019'); // already staff
    expect((await db.asErr('authenticated', w.A.owner, `select public.owner_add_staff($1,$2,'waiter','x')`, [w.A.owner, u]))?.code).toBe('42501');
    // the new waiter can use the staff screen straight away
    expect((await db.as<any>('authenticated', u, `select public.staff_me() r`))[0].r).toMatchObject({ role: 'waiter', display_name: 'Sam' });
    // audit: attributed to the owner even though the server used the service key
    const e = (await audit(w.A.rid, `and entity = 'staff' and action = 'insert'`)).pop();
    expect(e).toMatchObject({ actor_user_id: w.A.owner, actor_role: 'owner' });
  });
  it('change role / name, deactivate and reactivate; a deactivated user loses all access at once', async () => {
    const u = await newUser(`new2-${randomUUID().slice(0, 5)}@test.local`);
    await svc('owner_add_staff', [w.A.owner, u, 'waiter', 'Ria']);
    await svc('owner_set_staff', [w.A.owner, u, 'kitchen', 'Ria K', true]);
    expect((await db.as<any>('authenticated', u, `select public.staff_me() r`))[0].r).toMatchObject({ role: 'kitchen', display_name: 'Ria K' });
    await svc('owner_set_staff', [w.A.owner, u, 'kitchen', 'Ria K', false]);
    expect((await db.as<any>('authenticated', u, `select public.staff_me() r`))[0].r).toBeNull();
    expect((await db.asErr('authenticated', u, `select public.staff_get_board()`))?.code).toBe('GM011');
    await svc('owner_set_staff', [w.A.owner, u, 'kitchen', 'Ria K', true]);
    expect(await db.asErr('authenticated', u, `select public.staff_get_board()`)).toBeNull();
  });
  it('owners cannot be changed here, nobody can be made owner, and other restaurants\' staff are untouchable', async () => {
    expect((await svcErr('owner_set_staff', [w.A.owner, w.A.owner, 'manager', 'Me', true]))?.code).toBe('GM020');
    expect((await svcErr('owner_set_staff', [w.A.owner, w.A.waiter, 'owner', 'W', true]))?.code).toBe('GM015');
    expect((await svcErr('owner_set_staff', [w.A.owner, w.B.waiter, 'kitchen', 'W', false]))?.code).toBe('GM012');
    expect((await svcErr('owner_check_staff', [w.A.owner, w.B.waiter]))?.code).toBe('GM012');
    expect((await svcErr('owner_check_staff', [w.A.owner, w.A.owner]))?.code).toBe('GM020');
    expect(await svc('owner_check_staff', [w.A.owner, w.A.waiter])).toBe(true);
    expect((await audit(w.A.rid, `and action = 'staff_password_reset'`)).length).toBe(1);
    const [row] = await db.admin<any>(`select active, role from public.staff where user_id = $1`, [w.B.waiter]);
    expect(row).toEqual({ active: true, role: 'waiter' });
  });
  it('a suspended restaurant cannot add or change staff', async () => {
    const u = await newUser(`new3-${randomUUID().slice(0, 5)}@test.local`);
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await svcErr('owner_add_staff', [w.A.owner, u, 'waiter', 'Z']))?.code).toBe('GM001');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
  });
});

describe('report', () => {
  let rid: string;
  let owner: string;
  const ago = (iso: string) => iso;
  beforeAll(async () => {
    // an isolated restaurant so totals are exact
    const [r] = await db.admin<any>(`insert into public.restaurants (slug, name) values ('report-co','Report Co') returning id`);
    rid = r.id;
    const [u] = await db.admin<any>(`insert into auth.users (email) values ('owner@report.test') returning id`);
    owner = u.id;
    await db.admin(`insert into public.staff (user_id, restaurant_id, role, display_name) values ($1,$2,'owner','O')`, [owner, rid]);
    const [c] = await db.admin<any>(`insert into public.categories (restaurant_id, name_en) values ($1,'C') returning id`, [rid]);
    const mk = async (name: string, price: number) => (await db.admin<any>(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,$3,$4) returning id`, [rid, c.id, name, price]))[0].id as string;
    const tea = await mk('Tea', 3000);
    const biryani = await mk('Biryani', 30000);
    const [t] = await db.admin<any>(`insert into public.dining_tables (restaurant_id, label) values ($1,'1') returning id, qr_token`, [rid]);
    const ten = { rid, slug: 'report-co' } as never;
    void ten;
    const place = async (items: [string, number][]) => {
      const res = (await db.as<any>('service_role', null, `select public.guest_place_order($1,$2,$3::jsonb,null,$4,null) r`, ['report-co', t.qr_token, JSON.stringify(items.map(([id, q]) => ({ item_id: id, qty: q }))), randomUUID()]))[0].r;
      // keep the pending-order cap from interfering
      await db.admin(`update public.orders set status = 'served' where id = $1`, [res.order_id]);
      return res.order_id as string;
    };
    const o1 = await place([[tea, 2], [biryani, 1]]); // 36000
    const o2 = await place([[tea, 1]]); // 3000
    const o3 = await place([[biryani, 2]]); // 60000
    const o4 = await place([[tea, 5]]); // cancelled
    await db.admin(`update public.orders set status = 'cancelled', cancel_reason = 'x' where id = $1`, [o4]);
    // o3 happened "yesterday" (IST): outside 'today', inside 7d
    await db.admin(`update public.orders set created_at = (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '1 day' + interval '13 hours') at time zone 'Asia/Kolkata' where id = $1`, [o3]);
    // o1 at 10:30 IST today? set o1 and o2 to specific hours of today
    await db.admin(`update public.orders set created_at = (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '0 hours') at time zone 'Asia/Kolkata' where id = $1`, [o1]);
    await db.admin(`update public.orders set created_at = (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '0 hours') at time zone 'Asia/Kolkata' where id = $1`, [o2]);
    const [s] = await db.admin<any>(`select session_id from public.orders where id = $1`, [o1]);
    await db.admin(`update public.table_sessions set closed_at = now(), close_reason = 'paid' where id = $1`, [s.session_id]);
    await db.admin(`insert into public.review_clicks (restaurant_id, session_id) values ($1,$2), ($1,$2)`, [rid, s.session_id]);
    void ago;
  });
  it('today: orders, revenue, average, cancelled, review taps, top dishes and peak hours (cancelled orders excluded)', async () => {
    const r = await call<any>(owner, 'mgr_report', ['today']);
    expect(r).toMatchObject({ range: 'today', orders: 2, cancelled: 1, revenue_paise: 39000, average_order_paise: 19500, review_taps: 2 });
    expect(r.top_dishes).toEqual([{ name: 'Tea', qty: 3, revenue_paise: 9000 }, { name: 'Biryani', qty: 1, revenue_paise: 30000 }]);
    expect(r.peak_hours).toHaveLength(24);
    expect(r.peak_hours.find((h: any) => h.hour === 0)).toEqual({ hour: 0, orders: 2 });
    expect(r.peak_hours.reduce((a: number, h: any) => a + h.orders, 0)).toBe(2);
  });
  it('7 days includes yesterday; cancelled orders are counted separately and never in revenue', async () => {
    const r = await call<any>(owner, 'mgr_report', ['7d']);
    expect(r).toMatchObject({ orders: 3, revenue_paise: 99000, average_order_paise: 33000 });
    expect(r.top_dishes[0]).toEqual({ name: 'Biryani', qty: 3, revenue_paise: 90000 });
    expect(r.peak_hours.find((h: any) => h.hour === 13).orders).toBe(1);
    const r30 = await call<any>(owner, 'mgr_report', ['30d']);
    expect(r30.orders).toBe(3);
    expect(r30.cancelled).toBe(1);
  });
  it('an empty period gives zeros (no divide-by-zero) and bad ranges are refused', async () => {
    const r = await call<any>(w.B.owner, 'mgr_report', ['today']);
    expect(r.average_order_paise).toBe(0);
    expect(r.top_dishes).toEqual([]);
    expect((await err(owner, 'mgr_report', ['yesterday']))?.code).toBe('GM015');
    expect((await err(owner, 'mgr_report', [null]))?.code).toBe('GM015');
  });
  it('never includes another restaurant\'s numbers', async () => {
    const mine = await call<any>(w.A.owner, 'mgr_report', ['30d']);
    expect(JSON.stringify(mine)).not.toContain('Biryani');
  });
});

describe('audit log viewer', () => {
  it('lists newest first with the actor\'s name, only for this restaurant, with paging', async () => {
    await saveItem(w.A.manager, { name: 'Audit Viewer Dish' });
    const page1 = await call<any[]>(w.A.owner, 'mgr_get_audit', [5]);
    expect(page1).toHaveLength(5);
    expect(page1[0].id).toBeGreaterThan(page1[1].id);
    expect(page1.find((e) => e.action === 'insert' && e.entity === 'items' && e.details.name_en === 'Audit Viewer Dish')).toMatchObject({ actor_name: expect.stringMatching(/manager/i), actor_role: 'manager' });
    const page2 = await call<any[]>(w.A.owner, 'mgr_get_audit', [5, page1[4].id]);
    expect(page2.every((e) => e.id < page1[4].id)).toBe(true);
    expect(JSON.stringify(page1) + JSON.stringify(page2)).not.toContain('spice-garden');
    for (const uid of [w.B.owner]) {
      const theirs = await call<any[]>(uid, 'mgr_get_audit', [200]);
      expect(JSON.stringify(theirs)).not.toContain('Audit Viewer Dish');
    }
  });
  it('never exposes QR tokens, and caps the page size', async () => {
    const [t] = await db.admin<any>(`select qr_token from public.dining_tables where restaurant_id = $1 limit 1`, [w.A.rid]);
    await call(w.A.owner, 'mgr_rotate_table_token', [w.A.t1.id]);
    const all = JSON.stringify(await call<any[]>(w.A.owner, 'mgr_get_audit', [10000]));
    expect(all).not.toContain(t.qr_token);
    expect((await call<any[]>(w.A.owner, 'mgr_get_audit', [10000])).length).toBeLessThanOrEqual(200);
  });
});

describe('public profile', () => {
  const args = (o: Record<string, string> = {}) => {
    const v = { tagline: 'Best chai in town', description: 'Family run since 1999', logo: '', banner: '', address: 'MI Road, Jaipur', hours: 'Daily 11 am - 11 pm', explore: 'tattoo-cafe_1', ...o };
    return [v.tagline, v.description, v.logo, v.banner, v.address, v.hours, v.explore];
  };
  it('only the owner can change it; the guest menu then shows exactly the public fields', async () => {
    expect((await err(w.A.manager, 'mgr_update_profile', args()))?.code).toBe('GM011');
    expect((await err(w.A.waiter, 'mgr_update_profile', args()))?.code).toBe('GM011');
    expect(await err(w.A.owner, 'mgr_update_profile', args({ logo: `${w.A.rid}/${randomUUID()}.webp` }))).toBeNull();
    const menu = (await db.as<any>('service_role', null, `select public.guest_get_menu($1, null) m`, [w.A.slug]))[0].m;
    expect(menu.restaurant).toMatchObject({ tagline: 'Best chai in town', address: 'MI Road, Jaipur', explore_code: 'tattoo-cafe_1' });
    expect(menu.restaurant.logo_path).toContain(w.A.rid);
    // no phone, WhatsApp, Instagram or review link is sent to guests any more
    expect(Object.keys(menu.restaurant).sort()).toEqual(['accent', 'address', 'banner_path', 'description', 'explore_code', 'hours_text', 'logo_path', 'name', 'slug', 'tagline']);
    const settings = await call<any>(w.A.manager, 'mgr_get_settings');
    expect(settings).toMatchObject({ tagline: 'Best chai in town', id: w.A.rid, explore_code: 'tattoo-cafe_1' });
  });
  it('another restaurant is untouched and bad values are refused', async () => {
    const [b] = await db.admin<any>(`select tagline, explore_code from public.restaurants where id = $1`, [w.B.rid]);
    expect(b).toMatchObject({ tagline: null, explore_code: null });
    expect((await err(w.A.owner, 'mgr_update_profile', args({ explore: 'a/b' })))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_update_profile', args({ explore: 'https://evil.example' })))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_update_profile', args({ logo: `${w.B.rid}/${randomUUID()}.webp` })))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_update_profile', args({ banner: `${w.A.rid}/../x.webp` })))?.code).toBe('GM015');
    expect(await err(w.A.owner, 'mgr_update_profile', args({ tagline: '', description: '', address: '', hours: '', explore: '' }))).toBeNull();
    const [r] = await db.admin<any>(`select tagline, explore_code from public.restaurants where id = $1`, [w.A.rid]);
    expect(r).toMatchObject({ tagline: null, explore_code: null });
  });
});

describe('menu analytics', () => {
  const visit = randomUUID();
  const rec = (event: string, o: { token?: string | null; item?: string | null; cat?: string | null; slug?: string; visit?: string } = {}) =>
    svc<boolean>('guest_record_event', [o.slug ?? w.A.slug, o.token ?? null, o.visit ?? visit, event, o.item ?? null, o.cat ?? null, 'iphash']);
  const a = (uid: string, range = '7d') => call<any>(uid, 'mgr_analytics', [range]);

  it('records events, counts a refresh once, and ignores unknown or foreign references', async () => {
    const before = (await a(w.A.owner)).totals;
    expect(await rec('menu_opened')).toBe(true);
    expect(await rec('menu_opened')).toBe(false); // same visit within 30 minutes: a refresh, not a new open
    expect(await rec('menu_opened', { visit: randomUUID() })).toBe(true);
    expect(await rec('item_viewed', { item: w.A.paneer })).toBe(true);
    expect(await rec('item_viewed', { item: w.A.paneer })).toBe(false);
    expect(await rec('item_viewed', { item: w.B.paneer })).toBe(false); // foreign item: reference dropped, nothing to count
    expect(await rec('category_viewed', { cat: w.A.catId })).toBe(true);
    expect(await rec('search')).toBe(true);
    expect(await rec('whatsapp_click')).toBe(true);
    expect(await svcErr('guest_record_event', [w.A.slug, null, visit, 'not_an_event', null, null, 'iphash'])).not.toBeNull(); // the table only accepts known events
    const t = (await a(w.A.owner)).totals;
    expect(t.menu_opens - before.menu_opens).toBe(2);
    expect(t.item_views - before.item_views).toBe(1);
    expect(t.searches - before.searches).toBe(1);
    expect(t.whatsapp - before.whatsapp).toBe(1);
    const top = await a(w.A.owner);
    expect(top.top_items[0]).toMatchObject({ name: 'Paneer Butter Masala', views: 1 });
    expect(top.categories[0].views).toBe(1);
  });
  it('qr_landing needs a real table token and is counted per table', async () => {
    const [tb] = await db.admin<any>(`select qr_token, label from public.dining_tables where restaurant_id = $1 and active order by created_at limit 1`, [w.A.rid]);
    expect(await rec('qr_landing', { token: 'f'.repeat(64), visit: randomUUID() })).toBe(false);
    expect(await rec('qr_landing', { token: tb.qr_token, visit: randomUUID() })).toBe(true);
    const r = await a(w.A.manager);
    expect(r.tables.find((x: any) => x.label === tb.label)?.scans).toBeGreaterThanOrEqual(1);
    expect(r.daily.length).toBe(7);
  });
  it('is private to the restaurant and to owner / manager; suspended restaurants record nothing; old events are purged', async () => {
    expect(((await a(w.B.owner)).totals).menu_opens).toBe(0);
    expect((await err(w.A.waiter, 'mgr_analytics', ['7d']))?.code).toBe('GM011');
    expect((await err(w.A.owner, 'mgr_analytics', ['1y']))?.code).toBe('GM015');
    expect(await db.asErr('authenticated', w.A.owner, `select count(*) from public.menu_events`, [] as never)).not.toBeNull(); // no direct reads
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.B.rid]);
    expect(await rec('menu_opened', { slug: w.B.slug, visit: randomUUID() })).toBe(false);
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.B.rid]);
    await db.admin(`insert into public.menu_events (restaurant_id, visit_id, event, created_at) values ($1, $2, 'menu_opened', now() - interval '200 days')`, [w.A.rid, randomUUID()]);
    await rec('search', { visit: randomUUID() });
    expect((await db.admin<any>(`select count(*)::int n from public.menu_events where created_at < now() - interval '180 days'`))[0].n).toBe(0);
  });
});

describe('orders only near the cafe', () => {
  const CAFE = { lat: 26.9124, lng: 75.7873 };
  const check = (slug: string, lat: number | null, lng: number | null, acc: number | null) => svc<string>('guest_check_location', [slug, lat, lng, acc]);
  it('only the owner can set it; it cannot be switched on without a position or with nonsense values', async () => {
    expect((await err(w.A.manager, 'mgr_update_location', [true, CAFE.lat, CAFE.lng, 150]))?.code).toBe('GM011');
    expect((await err(w.A.waiter, 'mgr_update_location', [true, CAFE.lat, CAFE.lng, 150]))?.code).toBe('GM011');
    expect((await err(w.A.owner, 'mgr_update_location', [true, null, null, 150]))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_update_location', [true, 91, 75, 150]))?.code).toBe('GM015');
    expect((await err(w.A.owner, 'mgr_update_location', [true, CAFE.lat, CAFE.lng, 10]))?.code).toBe('GM015');
    expect(await err(w.A.owner, 'mgr_update_location', [true, CAFE.lat, CAFE.lng, 150])).toBeNull();
    expect(await call<any>(w.A.manager, 'mgr_get_settings')).toMatchObject({ geo_required: true, geo_radius_m: 150, geo_lat: CAFE.lat });
    expect((await svcErr('mgr_update_location', [false, null, null, 150]))?.code).toBeDefined(); // not callable with the service key
  });
  it('checks distance with the phone\'s own accuracy as a margin, and only for restaurants that switched it on', async () => {
    expect(await check(w.B.slug, null, null, null)).toBe('ok'); // restaurant B never switched it on
    expect(await check(w.A.slug, null, null, null)).toBe('required');
    expect(await check(w.A.slug, CAFE.lat, CAFE.lng, 900)).toBe('inaccurate');
    expect(await check(w.A.slug, CAFE.lat, CAFE.lng, null)).toBe('inaccurate');
    expect(await check(w.A.slug, CAFE.lat + 0.0005, CAFE.lng, 20)).toBe('ok'); // about 55 m
    expect(await check(w.A.slug, CAFE.lat + 0.0027, CAFE.lng, 10)).toBe('too_far'); // about 300 m with a good fix
    expect(await check(w.A.slug, CAFE.lat + 0.0027, CAFE.lng, 200)).toBe('ok'); // same spot, poor fix: benefit of the doubt (150 + 200)
    expect(await check(w.A.slug, CAFE.lat + 0.1, CAFE.lng, 200)).toBe('too_far');
    expect(await check(w.A.slug, 123, CAFE.lng, 10)).toBe('required');
    expect(await check('no-such-cafe', null, null, null)).toBe('ok'); // unknown restaurants fail later, with the usual not-found
    await db.admin(`update public.restaurants set geo_required = false where id = $1`, [w.A.rid]);
    expect(await check(w.A.slug, CAFE.lat + 0.1, CAFE.lng, 10)).toBe('ok');
  });
});
