import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Counter billing and reports (migration 0073). Money is worked out by hand: 5% GST split in two halves, round-off to whole rupees.
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
const day = async (n: number) => (await db.admin<{ d: string }>(`select to_char((now() at time zone 'Asia/Kolkata')::date + $1::int, 'YYYY-MM-DD') as d`, [n]))[0]!.d;
let dish: string;
let roomId: string;
const create = (uid: string, lines: unknown, mode = 'cash', stay: string | null = null, label: string | null = 'Table 4') =>
  asU(uid, `select public.padh_pos_create($1,$2,null,$3,$4::uuid) as r`, [JSON.stringify(lines), label, mode, stay]);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled, room_dining) values ($1, true, true)`, [w.A.rid]);
  const [c] = await db.admin<{ id: string }>(`insert into public.categories (restaurant_id, name_en) values ($1,'Counter mains') returning id`, [w.A.rid]);
  dish = (await db.admin<{ id: string }>(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,'Paneer Butter Masala',32000) returning id`, [w.A.rid, c!.id]))[0]!.id;
  roomId = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'401') returning id`, [w.A.rid]))[0]!.id;
  // the hotel's food tax: GST 5%
  await asU(w.A.owner, `select public.padh_tax_presets_add() as r`);
  const setup = await asU(w.A.owner, `select public.padh_billing_get() as r`);
  const five = setup.tax_rates.find((t: any) => t.name === 'GST 5%').id;
  const food = setup.categories.find((x: any) => x.kind === 'food');
  await asU(w.A.owner, `select public.padh_category_save($1::uuid,$2,null,$3::uuid,true) as r`, [food.id, food.name, five]);
});
afterAll(async () => db.close());

describe('counter billing', () => {
  it('the price comes from the menu, never from the screen; 2 x 320 = 640 + 5% = 672', async () => {
    const m = await asU(w.A.waiter, `select public.padh_pos_menu() as r`);
    expect(m.tax_bp).toBe(500);
    expect(m.categories[0].items[0].price_paise).toBe(32000);
    const b = await create(w.A.waiter, [{ item: dish, qty: 2, unit_paise: 1 }]); // a forged price is ignored
    expect(b.total_paise).toBe(67200);
    expect(b.number).toMatch(/^POS\/\d{4}-\d{2}\/0001$/);
    const g = await asU(w.A.waiter, `select public.padh_pos_get($1::uuid) as r`, [b.id]);
    expect(g).toMatchObject({ subtotal_paise: 64000, tax_paise: 3200, round_paise: 0, total_paise: 67200, pay_mode: 'cash' });
    expect(g.lines[0]).toMatchObject({ name: 'Paneer Butter Masala', qty: 2, unit_paise: 32000, amount_paise: 64000 });
  });
  it('a custom line works, the total is rounded to a rupee, and numbers have no gaps', async () => {
    const b = await create(w.A.manager, [{ name: 'Masala tea', qty: 3, unit_paise: 1850 }], 'upi'); // 55.50 + 2.78 tax (1.39 each half) = 58.28 -> 58.00
    expect(b.number).toMatch(/\/0002$/);
    expect(b.total_paise).toBe(5800);
    const g = await asU(w.A.manager, `select public.padh_pos_get($1::uuid) as r`, [b.id]);
    expect(g).toMatchObject({ subtotal_paise: 5550, tax_paise: 278, round_paise: -28 });
  });
  it('bad bills are refused: empty, bad quantity, unknown payment mode, a room bill with no guest', async () => {
    for (const lines of [[], [{ name: 'X', qty: 0, unit_paise: 100 }], [{ name: 'X', qty: 1, unit_paise: 0 }], [{ qty: 1, unit_paise: 100 }], [{ item: '00000000-0000-0000-0000-000000000000', qty: 1 }]]) {
      expect((await errU(w.A.waiter, `select public.padh_pos_create($1,null,null,'cash',null)`, [JSON.stringify(lines)]))?.code).toBe('GM015');
    }
    expect((await errU(w.A.waiter, `select public.padh_pos_create($1,null,null,'crypto',null)`, [JSON.stringify([{ name: 'X', qty: 1, unit_paise: 100 }])]))?.code).toBe('GM015');
    expect((await errU(w.A.waiter, `select public.padh_pos_create($1,null,null,'room',null)`, [JSON.stringify([{ name: 'X', qty: 1, unit_paise: 100 }])]))?.code).toBe('GM015');
    expect((await errU(w.A.waiter, `select public.padh_pos_create('not json',null,null,'cash',null)`))?.code).toBe('GM015');
  });
  it('the kitchen and strangers cannot bill', async () => {
    for (const uid of [w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_pos_menu()`))?.code).toBe('GM011');
  });
  it('a bill put on a guest\'s room goes onto their folio (the folio adds the tax); voiding takes it off again', async () => {
    const st = await asU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Room Guest','9876543210',null,null,1,null,null,null,null,200000,$2::date,0,null) as r`, [roomId, await day(2)]);
    const b = await create(w.A.waiter, [{ name: 'Dinner', qty: 1, unit_paise: 100000 }], 'room', st.stay_id);
    const f1 = (await asU(w.A.waiter, `select public.padh_folio($1::uuid) as r`, [st.stay_id])).folio;
    expect(f1.lines.some((l: any) => l.description === `Restaurant bill ${b.number}`)).toBe(true);
    await asU(w.A.manager, `select public.padh_pos_void($1::uuid,'wrong table') as r`, [b.id]);
    const f2 = (await asU(w.A.waiter, `select public.padh_folio($1::uuid) as r`, [st.stay_id])).folio;
    expect(f2.lines.some((l: any) => l.description === `Restaurant bill ${b.number}`)).toBe(false);
    expect((await errU(w.A.manager, `select public.padh_pos_void($1::uuid,'again')`, [b.id]))?.code).toBe('GM012');
    expect((await errU(w.A.waiter, `select public.padh_pos_void($1::uuid,'x')`, [b.id]))?.code).toBe('GM011');
  });
  it('another hotel cannot read this bill; the day list shows bills with their payment modes', async () => {
    const list = await asU(w.A.waiter, `select public.padh_pos_list(null) as r`);
    expect(list.bills.length).toBeGreaterThanOrEqual(3);
    await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true) on conflict do nothing`, [w.B.rid]);
    expect((await errU(w.B.owner, `select public.padh_pos_get($1::uuid)`, [list.bills[0].id]))?.code).toBe('GM012');
  });
});

describe('reports', () => {
  it('only the owner and manager read reports; the range is limited', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await errU(uid, `select public.padh_report(current_date, current_date)`))?.code).toBe('GM011');
    expect((await errU(w.A.owner, `select public.padh_report(current_date, current_date - 1)`))?.code).toBe('GM015');
    expect((await errU(w.A.owner, `select public.padh_report(current_date - 400, current_date)`))?.code).toBe('GM015');
  });
  it('today shows the counter sales (voided ones left out), the money by mode and the rooms sold', async () => {
    const t = await day(0);
    const r = await asU(w.A.owner, `select public.padh_report($1::date,$1::date) as r`, [t]);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]).toMatchObject({ day: t, food: 64000 + 5550, pos_bills: 2, rooms_sold: 1 });
    expect(r.by_mode).toEqual({ cash: 67200, upi: 5800 });
    expect(r.days[0].collected).toBe(73000);
    expect(r.rooms).toBeGreaterThanOrEqual(1);
  });
  it('an invoice counts as room, food and other sales on the day it was issued', async () => {
    const rid = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'402') returning id`, [w.A.rid]))[0]!.id;
    const st = await asU(w.A.waiter, `select public.padh_stay_checkin($1::uuid,'Invoice Guest',null,null,null,1,null,null,null,null,300000,$2::date,0,null) as r`, [rid, await day(1)]);
    const cats = (await asU(w.A.owner, `select public.padh_billing_get() as r`)).categories;
    await asU(w.A.waiter, `select public.padh_folio_add($1::uuid,$2::uuid,'Laundry',2,50000) as r`, [st.stay_id, cats.find((c: any) => c.name === 'Laundry').id]);
    const total = (await asU(w.A.waiter, `select public.padh_folio($1::uuid,true) as r`, [st.stay_id])).folio.total_paise;
    await asU(w.A.waiter, `select public.padh_payment_add($1::uuid,'payment','card',$2::int,null) as r`, [st.stay_id, total]);
    await asU(w.A.waiter, `select public.padh_stay_checkout($1::uuid) as r`, [st.stay_id]);
    const t = await day(0);
    const d = (await asU(w.A.owner, `select public.padh_report($1::date,$1::date) as r`, [t])).days[0];
    expect(d.room).toBe(300000);
    expect(d.other).toBe(100000);
    expect(d.invoices).toBe(1);
  });
});
