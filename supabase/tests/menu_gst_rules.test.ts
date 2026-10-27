import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, type World } from './helpers/fixtures';

// GST by menu word, crossing a room-service order off the bill, and counter billing taxed line by line (migration 0078).
// Every amount is worked out by hand in paise.
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
const day = async (n: number) => (await db.admin<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date + $1::int, 'YYYY-MM-DD') as d`, [n]))[0]!.d;
const rule = (uid: string, word: string, bp: number, active = true) => asU(uid, `select public.padh_tax_rule_save($1,$2::int,$3::boolean) as r`, [word, bp, active]);
let stay: string;
let beer: string;
let orderNo: number;
let orderId: string;
const folio = async () => (await asU(w.A.waiter, `select public.padh_folio($1::uuid) as r`, [stay]));
const orderLines = (fo: any) => fo.folio.lines.filter((l: any) => l.src === 'order');
const pos = (lines: unknown, o: { tax?: number | null; service?: number; discount?: number; mode?: string; stay?: string | null } = {}) =>
  asU(w.A.waiter, `select public.padh_pos_bill($1,null,null,$2,$3::uuid,$4::int,$5::int,$6::int) as r`, [JSON.stringify(lines), o.mode ?? 'cash', o.stay ?? null, o.tax ?? null, o.service ?? 0, o.discount ?? 0]);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, true)`, [w.A.rid]);
  const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'301') returning id`, [w.A.rid]))[0]!.id;
  await asU(w.A.owner, `select public.padh_tax_presets_add() as r`);
  const setup = await asU(w.A.owner, `select public.padh_billing_get() as r`);
  const five = setup.tax_rates.find((t: any) => t.name === 'GST 5%').id;
  const food = setup.categories.find((x: any) => x.kind === 'food');
  await asU(w.A.owner, `select public.padh_category_save($1::uuid,$2,null,$3::uuid,true) as r`, [food.id, food.name, five]);
  const [bar] = await db.admin<{ id: string }>(`insert into public.categories (restaurant_id, name_en) values ($1,'Bar') returning id`, [w.A.rid]);
  beer = (await db.admin<{ id: string }>(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,'Kingfisher Beer',30000) returning id`, [w.A.rid, bar!.id]))[0]!.id;
  stay = (await asU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Rohan Mehta','98765 43210','aadhaar','4321',2,null,null,null,null,100000,$2::date,0,null) as r`, [room, await day(1)])).stay_id;
  const [t] = await db.admin<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label, kind) values ($1, 'Room 301', 'room') returning qr_token`, [w.A.rid]);
  const placed = await placeOrder(db, w.A, { token: t!.qr_token }, [{ item_id: w.A.chai, qty: 2 }, { item_id: beer, qty: 1 }]);
  orderNo = placed.order_no;
  await db.admin(`update public.orders set pay_method = 'room_bill' where restaurant_id = $1 and order_no = $2`, [w.A.rid, orderNo]);
  orderId = (await db.admin<{ id: string }>(`select id from public.orders where restaurant_id = $1 and order_no = $2`, [w.A.rid, orderNo]))[0]!.id;
});
afterAll(async () => db.close());

describe('room service on the bill, dish by dish', () => {
  it('with no rules every dish takes the usual food tax (5%); chai 2 x 30 + beer 300 = 360', async () => {
    const l = orderLines(await folio());
    expect(l.map((x: any) => [x.description.split(' · ').pop(), x.amount_paise, x.tax_bp])).toEqual([['Kingfisher Beer', 30000, 500], ['Masala Chai', 6000, 500]]);
    expect(l.every((x: any) => x.order_id === orderId)).toBe(true);
  });
  it('a rule by the word "beer" with 0% takes the tax off the beer only', async () => {
    await rule(w.A.owner, 'Beer', 0);
    const fo = await folio();
    expect(orderLines(fo).map((x: any) => x.tax_bp)).toEqual([0, 500]); // the lines are in the order of the dish names
    const g5 = fo.folio.tax_groups.find((g: any) => g.tax_bp === 500);
    expect(g5.taxable_paise).toBe(6000);
    expect(g5.tax_paise).toBe(300);
  });
  it('the section name counts too, the longest word wins, plurals match, and a word inside a longer word does not', async () => {
    await rule(w.A.owner, 'bar', 1800); // the dish is in the section "Bar"; "beer" (longer) still wins
    expect(orderLines(await folio()).map((x: any) => x.tax_bp)).toEqual([0, 500]);
    await rule(w.A.owner, 'beer', 0, false); // switched off: the section rule now applies
    expect(orderLines(await folio()).map((x: any) => x.tax_bp)).toEqual([1800, 500]);
    const [p] = await db.admin<{ rid: string }>(`select $1::uuid as rid`, [w.A.rid]);
    expect(((await db.admin<{ b: number | null }>(`select private.rule_bp($1::uuid,'Barbecue Platter','Mains') as b`, [p!.rid]))[0]!.b)).toBeNull();
    expect(((await db.admin<{ b: number | null }>(`select private.rule_bp($1::uuid,'Cocktail','Bars') as b`, [p!.rid]))[0]!.b)).toBe(1800);
    await rule(w.A.owner, 'beer', 0, true);
  });
  it('rules are the owner\'s or manager\'s to change; reception can read them; bad words and unknown rates are refused', async () => {
    const r = await asU(w.A.waiter, `select public.padh_tax_rules_get() as r`);
    expect(r.usual_bp).toBe(500);
    expect(r.rules.map((x: any) => [x.word, x.rate_bp, x.active]).sort()).toEqual([['bar', 1800, true], ['beer', 0, true]]);
    expect((await errU(w.A.waiter, `select public.padh_tax_rule_save('wine',0,true)`))?.code).toBe('GM011');
    for (const word of ['', 'a', 'wine!', 'x'.repeat(40)]) expect((await errU(w.A.manager, `select public.padh_tax_rule_save($1,0,true)`, [word]))?.code).toBe('GM015');
    expect((await errU(w.A.manager, `select public.padh_tax_rule_save('wine',777,true)`))?.code).toBe('GM015');
    expect((await rule(w.A.manager, '  Cold   Drink ', 1200)).id).toBeTruthy();
  });
  it('a room-service order is crossed out with a reason, shows in the crossed-out list, and comes back', async () => {
    const before = (await folio()).folio.total_paise;
    expect((await errU(w.A.waiter, `select public.padh_folio_order_skip($1::uuid,$2::uuid,true,'')`, [stay, orderId]))?.code).toBe('GM014');
    expect((await errU(w.A.waiter, `select public.padh_folio_order_skip($1::uuid,$2::uuid,true,'x')`, [stay, '00000000-0000-0000-0000-000000000000']))?.code).toBe('GM012');
    await asU(w.A.waiter, `select public.padh_folio_order_skip($1::uuid,$2::uuid,true,'Guest never got it') as r`, [stay, orderId]);
    let fo = await folio();
    expect(orderLines(fo)).toEqual([]);
    expect(fo.skipped_orders).toEqual([{ order_id: orderId, order_no: orderNo, total_paise: 36000, reason: 'Guest never got it' }]);
    expect(fo.folio.total_paise).toBeLessThan(before);
    expect((await errU(w.A.waiter, `select public.padh_folio_order_skip($1::uuid,$2::uuid,true,'again')`, [stay, orderId]))?.code).toBe('GM012'); // not on the bill any more
    await asU(w.A.waiter, `select public.padh_folio_order_skip($1::uuid,$2::uuid,false,null) as r`, [stay, orderId]);
    fo = await folio();
    expect(orderLines(fo).length).toBe(2);
    expect(fo.skipped_orders).toEqual([]);
    expect(fo.folio.total_paise).toBe(before);
  });
  it('whatever an order holds beyond its dishes stays on the bill as "other", so the bill always equals the order', async () => {
    await db.admin(`update public.orders set total_paise = total_paise + 2500 where id = $1`, [orderId]);
    const l = orderLines(await folio());
    expect(l.map((x: any) => x.amount_paise)).toEqual([30000, 6000, 2500]);
    await db.admin(`update public.orders set total_paise = total_paise - 2500 where id = $1`, [orderId]);
  });
});

describe('counter billing taxed line by line', () => {
  it('the menu sends the rules; Thali 3 x 100 (5%) + beer 2 x 300 (0%), discount 50, service 10%: 950.58 -> 951', async () => {
    const m = await asU(w.A.waiter, `select public.padh_pos_menu() as r`);
    expect(m.rules).toEqual(expect.arrayContaining([{ word: 'beer', rate_bp: 0 }]));
    const b = await pos([{ name: 'Thali', qty: 3, unit_paise: 10000 }, { item: beer, qty: 2 }], { discount: 5000, service: 1000 });
    const g = await asU(w.A.waiter, `select public.padh_pos_get($1::uuid) as r`, [b.id]);
    expect(g.lines.map((x: any) => x.tax_bp)).toEqual([500, 0]);
    expect(g.tax_groups).toEqual([{ tax_bp: 0, taxable_paise: 62333, tax_paise: 0 }, { tax_bp: 500, taxable_paise: 31167, tax_paise: 1558 }]);
    expect(g).toMatchObject({ subtotal_paise: 90000, discount_paise: 5000, service_paise: 8500, tax_paise: 1558, round_paise: 42, total_paise: 95100 });
  });
  it('one rate for the whole bill overrides the rules: none, or 5% on everything', async () => {
    const none = await asU(w.A.waiter, `select public.padh_pos_get($1::uuid) as r`, [(await pos([{ item: beer, qty: 1 }, { name: 'Tea', qty: 1, unit_paise: 2000 }], { tax: 0 })).id]);
    expect(none).toMatchObject({ tax_paise: 0, total_paise: 32000 });
    const all = await asU(w.A.waiter, `select public.padh_pos_get($1::uuid) as r`, [(await pos([{ item: beer, qty: 1 }, { name: 'Tea', qty: 1, unit_paise: 2000 }], { tax: 500 })).id]);
    expect(all).toMatchObject({ tax_paise: 1600, total_paise: 33600 });
    expect((await errU(w.A.waiter, `select public.padh_pos_bill($1,null,null,'cash',null,777,0,0)`, [JSON.stringify([{ name: 'Tea', qty: 1, unit_paise: 2000 }])]))?.code).toBe('GM015');
  });
  it('on a room bill each rate becomes its own line with its own tax, and cancelling the bill takes all of them off', async () => {
    const before = (await folio()).folio;
    const b = await pos([{ name: 'Thali', qty: 1, unit_paise: 10000 }, { item: beer, qty: 1 }], { mode: 'room', stay });
    const fo = (await folio()).folio;
    const added = fo.lines.filter((l: any) => l.src === 'manual');
    expect(added.map((l: any) => [l.description.replace(/POS\/[\d-]+\/\d+/, 'POS'), l.amount_paise, l.tax_bp])).toEqual([['Restaurant bill POS · 5% GST', 10000, 500], ['Restaurant bill POS · no GST', 30000, 0]]);
    expect(fo.total_paise - before.total_paise).toBe(40500);
    await asU(w.A.manager, `select public.padh_pos_void($1::uuid,'wrong room') as r`, [b.id]);
    expect((await folio()).folio.total_paise).toBe(before.total_paise);
  });
});

describe('check-in time', () => {
  it('the desk sets the arrival time of today; a time ahead is held at now; a bad time or a stranger is refused', async () => {
    await asU(w.A.waiter, `select public.padh_stay_set_checkin($1::uuid,'00:01') as r`, [stay]);
    const [a] = await db.admin<{ t: string }>(`select to_char(check_in_at at time zone 'Asia/Kolkata', 'HH24:MI') as t from public.stays where id = $1`, [stay]);
    expect(a!.t).toBe('00:01');
    await asU(w.A.waiter, `select public.padh_stay_set_checkin($1::uuid,'23:59') as r`, [stay]);
    const [b] = await db.admin<{ ok: boolean }>(`select check_in_at <= now() as ok from public.stays where id = $1`, [stay]);
    expect(b!.ok).toBe(true);
    expect((await errU(w.A.waiter, `select public.padh_stay_set_checkin($1::uuid,'25:00')`, [stay]))?.code).toBe('GM015');
    expect((await errU(w.A.kitchen, `select public.padh_stay_set_checkin($1::uuid,'10:00')`, [stay]))?.code).toBe('GM011');
  });
});
