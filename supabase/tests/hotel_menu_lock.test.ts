import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// In a Padharosaa hotel only the platform admin changes the menu; everybody keeps the sold-out switch (migration 0053).
let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  await db.admin(`insert into public.hotel_settings (restaurant_id, enabled) values ($1, true)`, [w.A.rid]); // hotel A is a Padharosaa hotel; hotel B is an ordinary restaurant
});
afterAll(async () => db.close());
const as = (uid: string, sql: string, p: unknown[] = []) => db.as('authenticated', uid, sql, p as never);
const err = (uid: string, sql: string, p: unknown[] = []) => db.asErr('authenticated', uid, sql, p as never);

describe('a hotel menu is the platform admin\'s to change', () => {
  it('the hotel owner and manager cannot add, edit, delete, reorder, reprice or import anything', async () => {
    for (const uid of [w.A.owner, w.A.manager]) {
      expect((await err(uid, `select public.mgr_save_category(null, 'Mine', true)`))?.code, 'category').toBe('GM011');
      expect((await err(uid, `select public.mgr_save_item($1, $2, 'Hack', null, 100, 'veg', 0, null, false, false, true)`, [null, w.A.catId]))?.code, 'item').toBe('GM011');
      expect((await err(uid, `select public.mgr_save_item($1, $2, 'Renamed', null, 15000, 'veg', 0, null, false, false, true)`, [w.A.paneer, w.A.catId]))?.code, 'edit').toBe('GM011');
      expect((await err(uid, `select public.mgr_delete_item($1)`, [w.A.paneer]))?.code, 'delete').toBe('GM011');
      expect((await err(uid, `select public.mgr_delete_items($1::uuid[])`, [[w.A.paneer]]))?.code, 'bulk delete').toBe('GM011');
      expect((await err(uid, `select public.mgr_bulk_price($1::uuid[], 'percent', 10)`, [[w.A.paneer]]))?.code, 'prices').toBe('GM011');
      expect((await err(uid, `select public.mgr_reorder_items($1, $2::uuid[])`, [w.A.catId, [w.A.paneer, w.A.chai]]))?.code, 'reorder').toBe('GM011');
      expect((await err(uid, `select public.mgr_delete_category_all($1)`, [w.A.catId]))?.code, 'category delete').toBe('GM011');
    }
    expect((await db.admin<any>(`select name_en, price_paise from public.items where id = $1`, [w.A.paneer]))[0]).toMatchObject({ name_en: 'Paneer Butter Masala' });
  });

  it('reception, the kitchen, the manager and the owner can still switch a dish sold out and back', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.A.manager, w.A.owner]) {
      await as(uid, `select public.staff_set_item_availability($1::uuid[], false)`, [[w.A.paneer]]);
      expect((await db.admin<any>(`select is_available from public.items where id = $1`, [w.A.paneer]))[0].is_available, uid).toBe(false);
      await as(uid, `select public.staff_set_item_availability($1::uuid[], true)`, [[w.A.paneer]]);
    }
  });

  it('the platform admin, on a visit to the hotel, edits the menu as usual', async () => {
    await db.as('service_role', null, `select public.admin_menu_access($1, $2)`, [w.admin, w.A.rid]);
    const cat = (await as(w.admin, `select public.mgr_save_category(null, 'Added by Taprizz', true) as r`))[0]!.r as string;
    expect((await db.admin<any>(`select restaurant_id from public.categories where id = $1`, [cat]))[0].restaurant_id).toBe(w.A.rid);
    await as(w.admin, `select public.mgr_delete_category($1)`, [cat]);
    await db.as('service_role', null, `select public.admin_menu_leave($1)`, [w.admin]);
  });

  it('an ordinary restaurant (not a Padharosaa hotel) keeps editing its own menu', async () => {
    const cat = (await as(w.B.owner, `select public.mgr_save_category(null, 'Own category', true) as r`))[0]!.r as string;
    expect(cat).toBeTruthy();
    await as(w.B.owner, `select public.mgr_delete_category($1)`, [cat]);
  });

  it('the server itself (no signed-in person: seeds, copying and deleting a restaurant) is not blocked', async () => {
    await db.admin(`insert into public.categories (restaurant_id, name_en) values ($1, 'Seeded')`, [w.A.rid]);
    expect((await db.admin<any>(`select count(*)::int n from public.categories where restaurant_id = $1 and name_en = 'Seeded'`, [w.A.rid]))[0].n).toBe(1);
    expect((await db.asErr('service_role', null, `select public.admin_delete_restaurant($1, $2, $3)`, [w.admin, w.A.rid, w.A.slug]))).toBeNull(); // the whole hotel and its menu can be removed by the admin
  });
});
