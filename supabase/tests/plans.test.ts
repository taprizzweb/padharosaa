import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());

const svc = async <T = any>(fn: string, args: unknown[]): Promise<T> =>
  (await db.as('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;
const svcErr = (fn: string, args: unknown[]) => db.asErr('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const asOwnerErr = (fn: string, args: unknown[]) => db.asErr('authenticated', w.A.owner, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args as never);
const savePlan = (o: Partial<{ id: string | null; name: string; points: string[]; setup: number; monthly: number; yearly: number; active: boolean; sort: number }> = {}) => {
  const a = { id: null, name: `Plan ${randomUUID().slice(0, 6)}`, points: ['Premium menu', ' QR ordering ', ''], setup: 1500000, monthly: 249900, yearly: 2499900, active: true, sort: 1, ...o };
  return [w.admin, a.id, a.name, a.points, a.setup, a.monthly, a.yearly, a.active, a.sort];
};

describe('plans', () => {
  it('only a platform admin can manage plans; points are trimmed; names are unique', async () => {
    expect((await svcErr('admin_save_plan', savePlan({}).map((v, i) => (i === 0 ? w.A.owner : v))))?.code).toBe('GM011');
    expect((await asOwnerErr('admin_list_plans', [w.admin]))?.code).toBeDefined(); // not callable by a signed-in user
    const id = await svc<string>('admin_save_plan', savePlan({ name: 'Signature' }));
    const list = await svc<any[]>('admin_list_plans', [w.admin]);
    const row = (await db.as<any>('service_role', null, `select * from public.admin_list_plans($1) where id = $2`, [w.admin, id]))[0];
    expect(list.length).toBeGreaterThan(0);
    expect(row).toMatchObject({ name: 'Signature', points: ['Premium menu', 'QR ordering'], setup_fee_paise: 1500000, monthly_paise: 249900, yearly_paise: 2499900, active: true, in_use: '0' });
    expect((await svcErr('admin_save_plan', savePlan({ name: 'signature' })))?.code).toBe('GM019'); // same name, other case
    expect((await svcErr('admin_save_plan', savePlan({ name: '' })))?.code).toBe('GM015');
    expect((await svcErr('admin_save_plan', savePlan({ monthly: -1 })))?.code).toBeDefined();
    expect((await svcErr('admin_save_plan', savePlan({ points: Array.from({ length: 21 }, (_, i) => `p${i}`) })))?.code).toBe('GM015');
    expect((await svcErr('admin_save_plan', savePlan({ points: ['x'.repeat(121)] })))?.code).toBe('GM015');
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where action = 'plan_saved' and restaurant_id is null`))[0].n).toBeGreaterThan(0);
  });

  it('assigning a plan sets the restaurant\'s own price and dates; renaming the plan renames it everywhere; a plan in use cannot be deleted', async () => {
    const id = await svc<string>('admin_save_plan', savePlan({ name: 'Elite' }));
    const starts = '2026-11-01T00:00:00Z';
    const ends = '2027-10-31T18:29:59Z';
    await svc('admin_set_billing', [w.admin, w.A.rid, id, null, 399900, 'monthly', 2000000, starts, ends, true, 5, 'Founding client']);
    const [r] = await db.admin<any>(`select plan, plan_id, price_paise, billing_period, setup_fee_paise, auto_pause, grace_days, billing_note, paid_until from public.restaurants where id = $1`, [w.A.rid]);
    expect(r).toMatchObject({ plan: 'Elite', plan_id: id, price_paise: 399900, billing_period: 'monthly', setup_fee_paise: 2000000, auto_pause: true, grace_days: 5, billing_note: 'Founding client' });
    await svc('admin_save_plan', savePlan({ id, name: 'Elite Plus' }));
    expect((await db.admin<any>(`select plan from public.restaurants where id = $1`, [w.A.rid]))[0].plan).toBe('Elite Plus');
    expect((await svcErr('admin_delete_plan', [w.admin, id]))?.code).toBe('GM019');
    // a custom deal with no catalogue plan
    await svc('admin_set_billing', [w.admin, w.A.rid, null, 'Custom deal', 100, 'one_time', 0, null, null, false, 0, null]);
    expect((await db.admin<any>(`select plan, plan_id from public.restaurants where id = $1`, [w.A.rid]))[0]).toMatchObject({ plan: 'Custom deal', plan_id: null });
    await svc('admin_delete_plan', [w.admin, id]);
    // validation
    for (const bad of [
      [w.admin, w.A.rid, null, 'x', -1, 'monthly', 0, null, null, false, 0, null],
      [w.admin, w.A.rid, null, 'x', 1, 'weekly', 0, null, null, false, 0, null],
      [w.admin, w.A.rid, null, 'x', 1, 'monthly', 0, null, null, false, 61, null],
      [w.admin, w.A.rid, null, 'x', 1, 'monthly', 0, ends, starts, false, 0, null], // ends before it starts
      [w.admin, w.A.rid, null, '', 1, 'monthly', 0, null, null, false, 0, null],
    ]) expect((await svcErr('admin_set_billing', bad))?.code, JSON.stringify(bad)).toBe('GM015');
    expect((await svcErr('admin_set_billing', [w.admin, randomUUID(), null, 'x', 1, 'monthly', 0, null, null, false, 0, null]))?.code).toBe('GM012');
  });
});

describe('end date and automatic pause', () => {
  const menu = async (slug: string) => (await db.as<any>('service_role', null, `select public.guest_get_menu($1, null) m`, [slug]))[0].m;
  const set = (rid: string, ends: string | null, auto: boolean, grace: number) =>
    svc('admin_set_billing', [w.admin, rid, null, 'Test', 0, 'monthly', 0, null, ends, auto, grace, null]);
  it('an expired plan only pauses the menu and orders when automatic pause is on, and only after the grace days', async () => {
    const past = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
    await set(w.A.rid, past(2), false, 0);
    expect((await menu(w.A.slug)).status).toBe('active'); // overdue but not set to pause
    await set(w.A.rid, past(2), true, 5);
    expect((await menu(w.A.slug)).status).toBe('active'); // inside the grace days
    await set(w.A.rid, past(10), true, 5);
    expect((await menu(w.A.slug)).status).toBe('suspended');
    expect(await svc<string>('guest_check_location', [w.A.slug, null, null, null])).toBe('suspended');
    await set(w.A.rid, new Date(Date.now() + 86400_000).toISOString(), true, 0);
    expect((await menu(w.A.slug)).status).toBe('active'); // renewed
    expect(await svc<string>('guest_check_location', [w.A.slug, null, null, null])).toBe('ok');
    await set(w.A.rid, null, true, 0);
    expect((await menu(w.A.slug)).status).toBe('active'); // no end date = never expires
    const s = await db.as<any>('authenticated', w.A.owner, `select public.mgr_get_settings() s`);
    expect(s[0].s).toMatchObject({ auto_pause: true, grace_days: 0 });
  });
});

describe('rename', () => {
  it('renames a restaurant and a login, only inside the right restaurant, and audits both', async () => {
    await svc('admin_rename_restaurant', [w.admin, w.A.rid, '  New Name Cafe ']);
    expect((await db.admin<any>(`select name from public.restaurants where id = $1`, [w.A.rid]))[0].name).toBe('New Name Cafe');
    expect((await svcErr('admin_rename_restaurant', [w.admin, w.A.rid, '']))?.code).toBe('GM015');
    expect((await svcErr('admin_rename_restaurant', [w.A.owner, w.A.rid, 'Hacked']))?.code).toBe('GM011');
    await svc('admin_set_staff_name', [w.admin, w.A.rid, w.A.waiter, 'Ravi Kumar']);
    expect((await db.admin<any>(`select display_name from public.staff where user_id = $1`, [w.A.waiter]))[0].display_name).toBe('Ravi Kumar');
    expect((await svcErr('admin_set_staff_name', [w.admin, w.B.rid, w.A.waiter, 'Wrong place']))?.code).toBe('GM012'); // that login is not in restaurant B
    const a = await db.admin<any>(`select action from public.audit_log where restaurant_id = $1 and action in ('restaurant_renamed','staff_renamed') order by id`, [w.A.rid]);
    expect(a.map((x: any) => x.action)).toEqual(['restaurant_renamed', 'staff_renamed']);
  });
});

describe('duplicate a restaurant', () => {
  it('copies the look, categories and dishes into a new restaurant with its own owner; maps photos; copies nothing private', async () => {
    const photo = `${w.A.rid}/${randomUUID()}.webp`;
    await db.admin(`update public.items set image_path = $2 where id = $1`, [w.A.paneer, photo]);
    await db.admin(`update public.restaurants set tagline = 'Copy me', accent = 'teal', logo_path = $2 where id = $1`, [w.A.rid, `${w.A.rid}/${randomUUID()}.webp`]);
    const [owner] = await db.admin<{ id: string }>(`insert into auth.users (email) values ('dup-owner@test.local') returning id`);
    const r = await svc<{ id: string; images: { from: string; to: string }[] }>('admin_duplicate_restaurant', [w.admin, w.A.rid, 'copy-cafe', 'Copy Cafe', owner!.id, 'Dina']);
    const [n] = await db.admin<any>(`select * from public.restaurants where id = $1`, [r.id]);
    expect(n).toMatchObject({ slug: 'copy-cafe', name: 'Copy Cafe', tagline: 'Copy me', accent: 'teal', status: 'active', order_counter: '0', plan: 'pilot' });
    expect(n.review_url).toBeNull();
    const counts = await db.admin<any>(`select (select count(*)::int from public.categories where restaurant_id = $1) c, (select count(*)::int from public.items where restaurant_id = $1) i,
        (select count(*)::int from public.categories where restaurant_id = $2) c0, (select count(*)::int from public.items where restaurant_id = $2) i0,
        (select count(*)::int from public.dining_tables where restaurant_id = $1) t, (select count(*)::int from public.orders where restaurant_id = $1) o`, [r.id, w.A.rid]);
    expect(counts[0]).toMatchObject({ t: 0, o: 0 });
    expect(counts[0].c).toBe(counts[0].c0);
    expect(counts[0].i).toBe(counts[0].i0);
    expect((await db.admin<any>(`select role, display_name from public.staff where restaurant_id = $1`, [r.id]))).toEqual([{ role: 'owner', display_name: 'Dina' }]);
    // every photo got a new path inside the new restaurant's folder, and the original is untouched
    expect(r.images.length).toBe(2);
    for (const p of r.images) { expect(p.to.startsWith(`${r.id}/`)).toBe(true); expect(p.from.startsWith(`${w.A.rid}/`)).toBe(true); }
    const copiedDish = (await db.admin<any>(`select image_path from public.items where restaurant_id = $1 and name_en = 'Paneer Butter Masala'`, [r.id]))[0];
    expect(r.images.map((p) => p.to)).toContain(copiedDish.image_path);
    expect((await db.admin<any>(`select image_path from public.items where id = $1`, [w.A.paneer]))[0].image_path).toBe(photo);
    // clearing images that could not be copied
    await svc('admin_clear_images', [w.admin, r.id, [copiedDish.image_path]]);
    expect((await db.admin<any>(`select image_path from public.items where restaurant_id = $1 and name_en = 'Paneer Butter Masala'`, [r.id]))[0].image_path).toBeNull();
    // the copy is isolated from the original
    expect((await svcErr('admin_duplicate_restaurant', [w.admin, w.A.rid, 'copy-cafe', 'Again', owner!.id, 'D']))?.code).toBe('GM019'); // address taken
    expect((await svcErr('admin_duplicate_restaurant', [w.admin, randomUUID(), 'other-copy', 'X', owner!.id, 'D']))?.code).toBe('GM012');
    expect((await svcErr('admin_duplicate_restaurant', [w.A.owner, w.A.rid, 'sneaky', 'X', owner!.id, 'D']))?.code).toBe('GM011');
  });
});
