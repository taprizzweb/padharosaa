import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

// The platform admin can open any hotel's menu manager as its manager (migration 0051), and leave again.
let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());
const svc = (fn: string, a: unknown[]) => db.as('service_role', null, `select public.${fn}(${a.map((_, i) => `$${i + 1}`).join(',')})`, a as never);
const svcErr = (fn: string, a: unknown[]) => db.asErr('service_role', null, `select public.${fn}(${a.map((_, i) => `$${i + 1}`).join(',')})`, a as never);
const staffRow = async (uid: string) => (await db.admin<any>(`select restaurant_id, role, display_name from public.staff where user_id = $1`, [uid]))[0];

describe('admin visits a hotel menu', () => {
  it('only a platform admin can start or end a visit; the database functions are closed to everyone else', async () => {
    expect((await svcErr('admin_menu_access', [w.A.owner, w.A.rid]))?.code).toBe('GM011');
    expect((await svcErr('admin_menu_leave', [w.A.owner]))?.code).toBe('GM011');
    expect((await db.asErr('authenticated', w.admin, `select public.admin_menu_access($1, $2)`, [w.admin, w.A.rid]))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.admin_menu_leave($1)`, [w.admin]))?.code).toBe('42501');
    expect((await svcErr('admin_menu_access', [w.admin, '00000000-0000-0000-0000-000000000000']))?.code).toBe('GM012');
  });

  it('a visit makes the admin that hotel\'s manager: the real menu rules apply; it is logged; moving to another hotel moves the visit; leaving removes it', async () => {
    await svc('admin_menu_access', [w.admin, w.A.rid]);
    expect(await staffRow(w.admin)).toMatchObject({ restaurant_id: w.A.rid, role: 'manager', display_name: 'Taprizz admin (support)' });
    // the manager's own database rules: the admin can edit hotel A's menu and cannot touch hotel B's
    const cat = (await db.as<{ r: string }>('authenticated', w.admin, `select public.mgr_save_category(null, 'Added by admin', true) as r`))[0]!.r;
    expect((await db.admin<any>(`select restaurant_id from public.categories where id = $1`, [cat]))[0].restaurant_id).toBe(w.A.rid);
    expect((await db.asErr('authenticated', w.admin, `select public.mgr_delete_category($1)`, [w.B.catId]))?.code).toBe('GM012');
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where restaurant_id = $1 and action = 'admin_menu_visit' and actor_user_id = $2`, [w.A.rid, w.admin]))[0].n).toBe(1);
    await svc('admin_menu_access', [w.admin, w.B.rid]);
    expect(await staffRow(w.admin)).toMatchObject({ restaurant_id: w.B.rid });
    await svc('admin_menu_leave', [w.admin]);
    expect(await staffRow(w.admin)).toBeUndefined();
    await svc('admin_menu_leave', [w.admin]); // leaving twice is fine
  });

  it('an admin who is a real staff member of a hotel is never changed by a visit or by leaving', async () => {
    await db.admin(`insert into public.staff (user_id, restaurant_id, role, display_name) values ($1, $2, 'owner', 'Real Owner') on conflict (user_id) do nothing`, [w.admin, w.B.rid]);
    expect((await svcErr('admin_menu_access', [w.admin, w.A.rid]))?.code).toBe('GM019');
    await svc('admin_menu_leave', [w.admin]);
    expect(await staffRow(w.admin)).toMatchObject({ restaurant_id: w.B.rid, role: 'owner', display_name: 'Real Owner' });
    await db.admin(`delete from public.staff where user_id = $1`, [w.admin]);
  });
});
