import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, rpcErr, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());
afterEach(() => {
  db.aal = 'aal2';
});

// Every SQL function a signed-in owner/manager uses, called with a token that proves the password only.
const PRIVILEGED = [
  'public.staff_get_board()', 'public.staff_list_items()', 'public.mgr_get_menu()', 'public.mgr_get_settings()', 'public.mgr_get_staff()',
  `public.mgr_report('today')`, 'public.mgr_get_audit(10, null)', 'public.mgr_get_table_tokens()',
];

describe('restaurant owners and managers sign in with email + password only (owner decision)', () => {
  it('every dashboard and staff function works for owner and manager with a password-only session (aal1)', async () => {
    db.aal = 'aal1';
    for (const uid of [w.A.owner, w.A.manager]) {
      for (const call of PRIVILEGED) expect(await rpcErr(db, uid, call), `${call} as ${uid}`).toBeNull();
    }
  });
  it('writes work too (menu, availability, tables, prices)', async () => {
    db.aal = 'aal1';
    expect(await rpcErr(db, w.A.owner, `public.mgr_save_category(null, 'Pw only', true)`)).toBeNull();
    expect(await rpcErr(db, w.A.owner, `public.mgr_create_tables(60, 61)`)).toBeNull();
    expect(await rpcErr(db, w.A.manager, `public.staff_set_item_availability(array['${w.A.paneer}']::uuid[], true)`)).toBeNull();
    expect((await db.admin(`select 1 from public.categories where name_en = 'Pw only'`)).length).toBe(1);
  });
  it('row-level security still shows an owner exactly their own restaurant, and still keeps strangers out', async () => {
    db.aal = 'aal1';
    expect((await db.as('authenticated', w.A.owner, `select count(*)::int n from public.items`))[0]!.n).toBeGreaterThan(0);
    expect((await db.as('authenticated', w.A.owner, `select count(*)::int n from public.items where restaurant_id = '${w.B.rid}'`))[0]!.n).toBe(0);
    expect(await rpcErr(db, w.stranger, 'public.mgr_get_menu()')).not.toBeNull();
    expect(await rpcErr(db, w.A.waiter, 'public.mgr_get_menu()')).not.toBeNull();
  });
  it('a token with no aal claim at all works the same', async () => {
    const c = await db.pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: w.A.owner, role: 'authenticated' })]);
      await expect(c.query('select public.mgr_get_menu()')).resolves.toBeTruthy();
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
  it('photo storage rules work with a password-only session', async () => {
    db.aal = 'aal1';
    expect(await db.asErr('authenticated', w.A.owner, `insert into storage.objects (bucket_id, name, owner) values ('menu-images', '${w.A.rid}/pw.webp', '${w.A.owner}')`)).toBeNull();
    expect(await db.asErr('authenticated', w.A.owner, `insert into storage.objects (bucket_id, name, owner) values ('menu-images', '${w.B.rid}/steal.webp', '${w.A.owner}')`)).not.toBeNull();
  });
});

describe('admin_check', () => {
  it('is callable by the server (service role) only', async () => {
    expect((await db.as('service_role', null, `select public.admin_check($1) as r`, [w.admin]))[0]!.r).toBe(true);
    expect((await db.as('service_role', null, `select public.admin_check($1) as r`, [w.A.owner]))[0]!.r).toBe(false);
    expect((await db.asErr('authenticated', w.A.owner, `select public.admin_check('${w.admin}')`))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.admin_check('${w.admin}')`))?.code).toBe('42501');
  });
});
