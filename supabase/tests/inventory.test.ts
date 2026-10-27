import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// Inventory (migration 0072): items, the stock ledger, low-stock flags and who may do what.
let db: TestDb;
let w: World;
const asU = async (uid: string, sql: string, params: unknown[] = []) => (await db.as('authenticated', uid, sql, params as never))[0]!.r as any;
const errU = (uid: string, sql: string, params: unknown[] = []) => db.asErr('authenticated', uid, sql, params as never);
let rice: string;
const move = (uid: string, kind: string, qty: number, cost: number | null = null, note: string | null = null) =>
  asU(uid, `select public.padh_inv_move($1::uuid,$2,$3::numeric,$4::int,$5) as r`, [rice, kind, qty, cost, note]);

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.A.rid]);
});
afterAll(async () => db.close());

describe('inventory', () => {
  it('only the owner and manager make items; the kitchen and reception can read; strangers cannot', async () => {
    rice = (await asU(w.A.manager, `select public.padh_inv_item_save(null,'Basmati rice','kg','Dry goods',10,true) as r`)).id;
    for (const uid of [w.A.waiter, w.A.kitchen]) expect((await errU(uid, `select public.padh_inv_item_save(null,'Oil','ltr',null,5,true)`))?.code).toBe('GM011');
    expect((await asU(w.A.kitchen, `select public.padh_inv_list() as r`)).length).toBe(1);
    expect((await errU(w.stranger, `select public.padh_inv_list()`))?.code).toBe('GM011');
    expect((await errU(w.A.owner, `select public.padh_inv_item_save(null,'basmati RICE','kg',null,1,true)`))?.code).toBe('GM019'); // the same name in other letters
    expect((await errU(w.A.owner, `select public.padh_inv_item_save(null,'','kg',null,1,true)`))?.code).toBe('GM015');
    expect((await errU(w.A.owner, `select public.padh_inv_item_save(null,'X','kg',null,-1,true)`))?.code).toBe('GM015');
  });
  it('stock in adds, used and waste take away, and it is never allowed to go below zero', async () => {
    expect((await move(w.A.manager, 'in', 25, 150000, 'Sharma traders')).stock).toBe(25);
    expect((await move(w.A.kitchen, 'out', 8.5)).stock).toBe(16.5);
    expect((await move(w.A.kitchen, 'waste', 1.25, null, 'wet bag')).stock).toBe(15.25);
    expect((await errU(w.A.kitchen, `select public.padh_inv_move($1::uuid,'out',100,null,null)`, [rice]))?.code).toBe('GM019');
    expect((await asU(w.A.owner, `select public.padh_inv_list() as r`))[0].stock).toBe(15.25);
  });
  it('buying and counting are for the owner and manager; a count corrects the stock; bad input is refused', async () => {
    expect((await errU(w.A.kitchen, `select public.padh_inv_move($1::uuid,'in',5,100,null)`, [rice]))?.code).toBe('GM011');
    expect((await errU(w.A.waiter, `select public.padh_inv_move($1::uuid,'adjust',5,null,null)`, [rice]))?.code).toBe('GM011');
    expect((await move(w.A.owner, 'adjust', 12, null, 'monthly count')).stock).toBe(12);
    for (const bad of [`'out',0,null`, `'out',-3,null`, `'in',1,-5`, `'out',1,100`, `'bogus',1,null`, `'out',1.0005,null`]) {
      expect((await errU(w.A.owner, `select public.padh_inv_move($1::uuid,${bad},null)`, [rice]))?.code).toBe('GM015');
    }
  });
  it('low stock is flagged when the stock is at or under the level; the ledger and the 30-day figures add up', async () => {
    await move(w.A.kitchen, 'out', 2); // 10 left = the level
    const [row] = await asU(w.A.owner, `select public.padh_inv_list() as r`);
    expect(row).toMatchObject({ stock: 10, low: true, used_30: 11.75, spent_30: 150000 });
    const log = await asU(w.A.owner, `select public.padh_inv_moves($1::uuid) as r`, [rice]);
    expect(log.map((m: any) => m.kind)).toEqual(['out', 'adjust', 'waste', 'out', 'in']);
    expect(log[4].cost_paise).toBe(150000);
  });
  it('another hotel cannot see or move this stock', async () => {
    await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true) on conflict do nothing`, [w.B.rid]);
    expect(await asU(w.B.owner, `select public.padh_inv_list() as r`)).toEqual([]);
    expect((await errU(w.B.owner, `select public.padh_inv_move($1::uuid,'out',1,null,null)`, [rice]))?.code).toBe('GM012');
    expect(await asU(w.B.owner, `select public.padh_inv_moves($1::uuid) as r`, [rice])).toEqual([]);
  });
});
