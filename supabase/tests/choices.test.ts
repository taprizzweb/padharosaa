import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, orderErr, placeOrder, rpc, rpcErr, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
let table: { id: string; token: string };
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
// each test gets its own table: a table only holds a few un-accepted orders at a time
beforeEach(async () => {
  const [t] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1, $2) returning id, qr_token`, [w.A.rid, `C${randomUUID().slice(0, 6)}`]);
  table = { id: t!.id, token: t!.qr_token };
});
afterAll(async () => db.close());

const save = (uid: string, item: string, variants: unknown, groups: unknown) =>
  rpc(db, uid, `public.mgr_save_item_choices($1, $2::jsonb, $3::jsonb)`, [item, JSON.stringify(variants), JSON.stringify(groups)]);
const saveErr = (uid: string, item: string, variants: unknown, groups: unknown) =>
  rpcErr(db, uid, `public.mgr_save_item_choices($1, $2::jsonb, $3::jsonb)`, [item, JSON.stringify(variants), JSON.stringify(groups)]);
const menuItem = async (id: string) => {
  const m = (await rpc(db, w.A.owner, `public.mgr_get_menu()`))[0]!.r as any;
  return m.categories.flatMap((c: any) => c.items).find((i: any) => i.id === id);
};
const guestItem = async (id: string) => {
  const m = (await db.as<any>('service_role', null, `select public.guest_get_menu($1, $2) r`, [w.A.slug, table.token]))[0].r;
  return m.categories.flatMap((c: any) => c.items).find((i: any) => i.id === id);
};
const newDish = async (name: string, price = 10000) => {
  const [r] = await db.admin<{ id: string }>(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1, $2, $3, $4) returning id`, [w.A.rid, w.A.catId, name, price]);
  return r!.id;
};
const lines = async (orderId: string) => db.admin<any>(`select name_en_snapshot n, unit_price_paise p, qty from public.order_items where order_id = $1 order by name_en_snapshot`, [orderId]);

describe('dish sizes and options', () => {
  it('saves sizes; the dish price follows the cheapest size; the guest menu and the editor both list them', async () => {
    const shake = await newDish('Oreo Shake', 20000);
    await save(w.A.manager, shake, [{ name: 'Small', price_paise: 12000 }, { name: 'Medium', price_paise: 16000 }, { name: 'Large', price_paise: 20000 }, { name: 'XL', price_paise: 25000, is_available: false }], []);
    const g = await guestItem(shake);
    expect(g.price_paise).toBe(12000);
    expect(g.variants.map((v: any) => [v.name, v.price_paise, v.is_available])).toEqual([['Small', 12000, true], ['Medium', 16000, true], ['Large', 20000, true], ['XL', 25000, false]]);
    expect(g.option_groups).toEqual([]);
    expect((await menuItem(shake)).variants).toHaveLength(4);
    // saving again with ids renames in place and can swap names without a collision; rows left out are removed
    const ids = (await menuItem(shake)).variants;
    await save(w.A.owner, shake, [{ id: ids[1].id, name: 'Small', price_paise: 13000 }, { id: ids[0].id, name: 'Medium', price_paise: 15000 }], []);
    const v = (await menuItem(shake)).variants;
    expect(v.map((x: any) => [x.name, x.price_paise])).toEqual([['Small', 13000], ['Medium', 15000]]);
    expect((await menuItem(shake)).price_paise).toBe(13000);
    // plain edits of the dish cannot override the cheapest-size rule
    await db.admin(`update public.items set price_paise = 99999 where id = $1`, [shake]);
    expect((await menuItem(shake)).price_paise).toBe(13000);
  });

  it('only owners and managers; only their own dishes; bad input is refused', async () => {
    const d = await newDish('Guarded');
    expect((await saveErr(w.A.waiter, d, [], []))?.code).toBe('GM011');
    expect((await saveErr(w.stranger, d, [], []))?.code).toBe('GM011');
    expect((await saveErr(w.B.owner, d, [], []))?.code).toBe('GM012'); // other restaurant's dish
    const bad: [unknown, unknown][] = [
      [[{ name: '', price_paise: 100 }], []],
      [[{ name: 'x'.repeat(31), price_paise: 100 }], []],
      [[{ name: 'S', price_paise: -1 }], []],
      [[{ name: 'S', price_paise: 1.5 }], []],
      [[{ name: 'S', price_paise: 100 }, { name: 's', price_paise: 200 }], []],
      [Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, price_paise: 1 })), []],
      [[], [{ name: 'G', required: true, max_select: 1, options: [] }]],
      [[], [{ name: 'G', required: true, max_select: 3, options: [{ name: 'a', price_delta_paise: 0 }] }]],
      [[], [{ name: 'G', required: 'yes', max_select: 1, options: [{ name: 'a' }] }]],
      [[], [{ name: 'G', required: true, max_select: 1, options: 'x' }]],
      [[], [{ name: 'G', required: true, max_select: 1, options: [{ name: 'a', price_delta_paise: -5 }] }]],
      [[], [{ name: 'G', required: true, max_select: 1, options: [{ name: 'a' }] }, { name: 'g', required: false, max_select: 1, options: [{ name: 'b' }] }]],
      ['nope', []],
      [[], {}],
    ];
    for (const [v, g] of bad) expect((await saveErr(w.A.owner, d, v, g))?.code, JSON.stringify([v, g]).slice(0, 80)).toBe('GM015');
  });

  it('an order for a sized dish is priced from the database and keeps a readable name', async () => {
    const shake = await newDish('Mango Shake', 10000);
    await save(w.A.owner, shake, [{ name: 'Small', price_paise: 12000 }, { name: 'Large', price_paise: 20000 }], []);
    const [small, large] = (await menuItem(shake)).variants;
    const o = await placeOrder(db, w.A, table, [{ item_id: shake, variant_id: large.id, qty: 2 }, { item_id: shake, variant_id: small.id, qty: 1 }]);
    expect(o.total_paise).toBe(2 * 20000 + 12000);
    expect(await lines(o.order_id)).toEqual([
      { n: 'Mango Shake (Large)', p: 20000, qty: 2 },
      { n: 'Mango Shake (Small)', p: 12000, qty: 1 },
    ]);
    // the same size twice is a duplicate; no size, a made-up size, another dish's size, or a size on a plain dish are refused
    expect((await orderErr(db, w.A, table, [{ item_id: shake, variant_id: large.id, qty: 1 }, { item_id: shake, variant_id: large.id, qty: 1 }]))?.code).toBe('GM005');
    expect((await orderErr(db, w.A, table, [{ item_id: shake, qty: 1 }]))?.code).toBe('GM015');
    expect((await orderErr(db, w.A, table, [{ item_id: shake, variant_id: randomUUID(), qty: 1 }]))?.code).toBe('GM004');
    const other = await newDish('Other Shake');
    await save(w.A.owner, other, [{ name: 'Big', price_paise: 5000 }], []);
    expect((await orderErr(db, w.A, table, [{ item_id: shake, variant_id: (await menuItem(other)).variants[0].id, qty: 1 }]))?.code).toBe('GM004');
    expect((await orderErr(db, w.A, table, [{ item_id: w.A.chai, variant_id: large.id, qty: 1 }]))?.code).toBe('GM015');
    // a price the browser invents is ignored: only ids are read
    const sneaky = await placeOrder(db, w.A, table, [{ item_id: shake, variant_id: small.id, qty: 1, price_paise: 1, unit_price_paise: 1 }]);
    expect(sneaky.total_paise).toBe(12000);
  });

  it('explicit nulls for size and options (as the web API sends them) behave like missing values', async () => {
    const o = await placeOrder(db, w.A, table, [{ item_id: w.A.chai, qty: 1, variant_id: null, option_ids: null }]);
    expect(o.total_paise).toBe(3000);
    expect(await lines(o.order_id)).toEqual([{ n: 'Masala Chai', p: 3000, qty: 1 }]);
  });

  it('a sold-out size cannot be ordered, a changed price applies to the next order only, an old order keeps its name and price', async () => {
    const d = await newDish('Half Full Biryani', 15000);
    await save(w.A.owner, d, [{ name: 'Half', price_paise: 15000 }, { name: 'Full', price_paise: 28000 }], []);
    const [half, full] = (await menuItem(d)).variants;
    const first = await placeOrder(db, w.A, table, [{ item_id: d, variant_id: full.id, qty: 1 }]);
    await save(w.A.owner, d, [{ id: half.id, name: 'Half', price_paise: 16000, is_available: false }, { id: full.id, name: 'Full', price_paise: 30000 }], []);
    expect((await orderErr(db, w.A, table, [{ item_id: d, variant_id: half.id, qty: 1 }]))?.code).toBe('GM003');
    expect((await placeOrder(db, w.A, table, [{ item_id: d, variant_id: full.id, qty: 1 }])).total_paise).toBe(30000);
    expect(await lines(first.order_id)).toEqual([{ n: 'Half Full Biryani (Full)', p: 28000, qty: 1 }]);
  });

  it('options: required choices, the most a guest may pick, extra prices, a readable name; wrong or foreign options are refused', async () => {
    const d = await newDish('Loaded Fries', 18000);
    await save(w.A.owner, d, [], [
      { name: 'Sauce', required: true, max_select: 1, options: [{ name: 'Peri peri', price_delta_paise: 0 }, { name: 'Cheese dip', price_delta_paise: 2000 }] },
      { name: 'Extras', required: false, max_select: 2, options: [{ name: 'Jalapeno', price_delta_paise: 1500 }, { name: 'Corn', price_delta_paise: 2500 }, { name: 'Olives', price_delta_paise: 3000 }] },
    ]);
    const m = await menuItem(d);
    expect(m.groups.map((g: any) => g.name)).toEqual(['Sauce', 'Extras']);
    expect(m.price_paise).toBe(18000); // no sizes: the dish's own price stays
    const [sauce, extras] = (await guestItem(d)).option_groups;
    const o = (g: any, n: string) => g.options.find((x: any) => x.name === n).id;
    expect(extras.max_select).toBe(2);

    const ok = await placeOrder(db, w.A, table, [{ item_id: d, qty: 2, option_ids: [o(sauce, 'Cheese dip'), o(extras, 'Jalapeno'), o(extras, 'Corn')] }]);
    expect(ok.total_paise).toBe(2 * (18000 + 2000 + 1500 + 2500));
    expect((await lines(ok.order_id))[0].n).toBe('Loaded Fries + Cheese dip, Jalapeno, Corn');

    expect((await orderErr(db, w.A, table, [{ item_id: d, qty: 1 }]))?.code).toBe('GM015');                                         // required sauce missing
    expect((await orderErr(db, w.A, table, [{ item_id: d, qty: 1, option_ids: [o(sauce, 'Peri peri'), o(sauce, 'Cheese dip')] }]))?.code).toBe('GM015'); // two sauces
    expect((await orderErr(db, w.A, table, [{ item_id: d, qty: 1, option_ids: [o(sauce, 'Peri peri'), o(extras, 'Jalapeno'), o(extras, 'Corn'), o(extras, 'Olives')] }]))?.code).toBe('GM015'); // 3 extras
    expect((await orderErr(db, w.A, table, [{ item_id: d, qty: 1, option_ids: [o(sauce, 'Peri peri'), o(sauce, 'Peri peri')] }]))?.code).toBe('GM015'); // repeated option
    expect((await orderErr(db, w.A, table, [{ item_id: d, qty: 1, option_ids: [randomUUID()] }]))?.code).toBe('GM004');
    const other = await newDish('Other Fries');
    await save(w.A.owner, other, [], [{ name: 'Dip', required: false, max_select: 1, options: [{ name: 'Mayo', price_delta_paise: 1 }] }]);
    expect((await orderErr(db, w.A, table, [{ item_id: d, qty: 1, option_ids: [o(sauce, 'Peri peri'), (await guestItem(other)).option_groups[0].options[0].id] }]))?.code).toBe('GM004');
    expect((await orderErr(db, w.A, table, [{ item_id: w.A.chai, qty: 1, option_ids: [o(sauce, 'Peri peri')] }]))?.code).toBe('GM004');
    // the same dish twice with different options is allowed; with identical options it is a duplicate
    expect((await placeOrder(db, w.A, table, [{ item_id: d, qty: 1, option_ids: [o(sauce, 'Peri peri')] }, { item_id: d, qty: 1, option_ids: [o(sauce, 'Cheese dip')] }])).total_paise).toBe(18000 + 20000);
    expect((await orderErr(db, w.A, table, [{ item_id: d, qty: 1, option_ids: [o(sauce, 'Peri peri'), o(extras, 'Corn')] }, { item_id: d, qty: 1, option_ids: [o(extras, 'Corn'), o(sauce, 'Peri peri')] }]))?.code).toBe('GM005');
  });

  it('sizes and options together: Large + extras, priced as size price plus extras', async () => {
    const d = await newDish('Burger Meal', 10000);
    await save(w.A.owner, d, [{ name: 'Regular', price_paise: 20000 }, { name: 'Large', price_paise: 26000 }], [
      { name: 'Side', required: true, max_select: 1, options: [{ name: 'Fries', price_delta_paise: 0 }, { name: 'Salad', price_delta_paise: 0 }] },
    ]);
    const g = await guestItem(d);
    const o = await placeOrder(db, w.A, table, [{ item_id: d, variant_id: g.variants[1].id, qty: 1, option_ids: [g.option_groups[0].options[1].id] }]);
    expect(o.total_paise).toBe(26000);
    expect((await lines(o.order_id))[0].n).toBe('Burger Meal (Large) + Salad');
  });

  it('removing a size keeps old orders intact and an old cart line for it is refused cleanly', async () => {
    const d = await newDish('Fading Shake');
    await save(w.A.owner, d, [{ name: 'Tall', price_paise: 9000 }], []);
    const tall = (await menuItem(d)).variants[0];
    const done = await placeOrder(db, w.A, table, [{ item_id: d, variant_id: tall.id, qty: 1 }]);
    await save(w.A.owner, d, [], []);
    expect((await guestItem(d)).variants).toEqual([]);
    expect(await lines(done.order_id)).toEqual([{ n: 'Fading Shake (Tall)', p: 9000, qty: 1 }]);
    expect((await orderErr(db, w.A, table, [{ item_id: d, variant_id: tall.id, qty: 1 }]))?.code).toBe('GM015'); // no sizes now, so a size id is invalid
    expect((await placeOrder(db, w.A, table, [{ item_id: d, qty: 1 }])).total_paise).toBeGreaterThan(0);
  });

  it('duplicating a dish copies its sizes and options; bulk price changes move every size', async () => {
    const d = await newDish('Copy Me', 10000);
    await save(w.A.owner, d, [{ name: 'S', price_paise: 10000 }, { name: 'L', price_paise: 20000 }], [{ name: 'Extra', required: false, max_select: 1, options: [{ name: 'Cheese', price_delta_paise: 3000 }] }]);
    const copy = (await rpc(db, w.A.owner, `public.mgr_duplicate_item($1)`, [d]))[0]!.r as string;
    const c = await menuItem(copy);
    expect(c.variants.map((v: any) => [v.name, v.price_paise])).toEqual([['S', 10000], ['L', 20000]]);
    expect(c.groups[0].options[0]).toMatchObject({ name: 'Cheese', price_delta_paise: 3000 });
    expect(c.variants[0].id).not.toBe((await menuItem(d)).variants[0].id); // its own rows
    await rpc(db, w.A.owner, `public.mgr_bulk_price($1::uuid[], 'percent', 10)`, [[d]]);
    const b = await menuItem(d);
    expect(b.variants.map((v: any) => v.price_paise)).toEqual([11000, 22000]);
    expect(b.price_paise).toBe(11000);
    expect((await menuItem(copy)).variants.map((v: any) => v.price_paise)).toEqual([10000, 20000]); // untouched
  });

  it('choices belong to one restaurant: nobody else can read or touch them, and nothing is reachable without the functions', async () => {
    const d = await newDish('Private Shake');
    await save(w.A.owner, d, [{ name: 'S', price_paise: 100 }], []);
    const asB = (await rpc(db, w.B.owner, `public.mgr_get_menu()`))[0]!.r as any;
    expect(JSON.stringify(asB)).not.toContain('Private Shake');
    for (const tbl of ['item_variants', 'item_option_groups', 'item_options']) {
      expect((await db.asErr('authenticated', w.A.owner, `select * from public.${tbl}`))?.code, tbl).toBe('42501');
      expect((await db.asErr('anon', null, `select * from public.${tbl}`))?.code, tbl).toBe('42501');
    }
    expect((await db.asErr('authenticated', w.A.owner, `select public.guest_place_order('x','y','[]'::jsonb,null,'zzzzzzzz',null)`))?.code).toBe('42501');
  });
});

describe('CSV import with sizes', () => {
  const imp = async (rows: unknown[]) => (await rpc(db, w.A.owner, `public.mgr_import_items($1::jsonb)`, [JSON.stringify(rows)]))[0]!.r as any;
  const base = { category: 'Shakes', description: '', diet: 'veg', spice: 0, bestseller: false, chef_pick: false, available: true };
  it('creates a dish with sizes, updates prices in place on a second import, and leaves sizes alone when a row has none', async () => {
    const name = `Imported ${randomUUID().slice(0, 4)}`;
    const first = await imp([{ ...base, name, price_paise: 12000, sizes: [{ name: 'Small', price_paise: 12000 }, { name: 'Large', price_paise: 20000 }] }]);
    expect(first).toMatchObject({ ok: true, created: 1 });
    const [row] = await db.admin<any>(`select id, price_paise from public.items where restaurant_id = $1 and name_en = $2`, [w.A.rid, name]);
    const ids1 = (await db.admin<any>(`select id, name from public.item_variants where item_id = $1 order by sort_order`, [row.id]));
    expect(ids1.map((v: any) => v.name)).toEqual(['Small', 'Large']);

    const second = await imp([{ ...base, name, price_paise: 13000, sizes: [{ name: 'large', price_paise: 22000 }, { name: 'XL', price_paise: 30000 }] }]);
    expect(second).toMatchObject({ ok: true, updated: 1 });
    const v2 = await db.admin<any>(`select id, name, price_paise from public.item_variants where item_id = $1 order by sort_order`, [row.id]);
    expect(v2.map((v: any) => [v.name.toLowerCase(), v.price_paise])).toEqual([['large', 22000], ['xl', 30000]]); // Small removed, Large updated, XL added
    expect(v2[0].id).toBe(ids1[1].id); // Large kept its row
    expect((await db.admin<any>(`select price_paise from public.items where id = $1`, [row.id]))[0].price_paise).toBe(22000); // cheapest size

    await imp([{ ...base, name, price_paise: 5000 }]); // no sizes in this row
    expect((await db.admin<any>(`select count(*)::int n from public.item_variants where item_id = $1`, [row.id]))[0].n).toBe(2);
  });
  it('refuses bad sizes without changing anything', async () => {
    const name = `Bad ${randomUUID().slice(0, 4)}`;
    for (const sizes of [[{ name: '', price_paise: 1 }], [{ name: 'S', price_paise: -1 }], [{ name: 'S', price_paise: 1 }, { name: 's', price_paise: 2 }], Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, price_paise: 1 })), 'nope']) {
      const r = await imp([{ ...base, name, price_paise: 100, sizes }]);
      expect(r.ok, JSON.stringify(sizes).slice(0, 40)).toBe(false);
    }
    expect((await db.admin<any>(`select count(*)::int n from public.items where restaurant_id = $1 and name_en = $2`, [w.A.rid, name]))[0].n).toBe(0);
  });
});
