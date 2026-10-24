import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, placeOrder, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
let orderIdA: string;

const TENANT_TABLES = [
  'restaurants', 'staff', 'categories', 'items', 'dining_tables', 'table_sessions', 'orders',
  'order_items', 'service_requests', 'review_clicks', 'audit_log',
];

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  // give restaurant A a row in every table
  const o = await placeOrder(db, w.A, w.A.t1, [{ item_id: w.A.paneer, qty: 1 }]);
  orderIdA = o.order_id;
  await db.as('service_role', null, `select public.guest_create_request($1,'waiter','water')`, [o.session_id]);
  await db.as('authenticated', w.A.owner, `update public.restaurants set name = 'Cafe Aroma Deluxe' where id = $1`, [w.A.rid]);
  // a closed table with a review click, so review_clicks has a row too
  const o2 = await placeOrder(db, w.A, w.A.t2, [{ item_id: w.A.chai, qty: 1 }]);
  await db.as('authenticated', w.A.manager, `select public.staff_close_session($1, true, 'test setup')`, [o2.session_id]);
  await db.as('service_role', null, `select public.guest_record_review_click($1)`, [o2.session_id]);
});
afterAll(async () => db.close());

describe('RLS is enabled everywhere', () => {
  it('every table in public has row level security on', async () => {
    const rows = await db.admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });
  it('the check actually sees tables (guards against a vacuous pass)', async () => {
    const [r] = await db.admin<{ n: number }>(`select count(*)::int n from pg_tables where schemaname = 'public' and rowsecurity`);
    expect(r!.n).toBeGreaterThanOrEqual(13);
  });
});

describe('anon has no access', () => {
  it('anon cannot select from any public table', async () => {
    const tables = await db.admin<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
    expect(tables.length).toBeGreaterThanOrEqual(13);
    for (const { tablename } of tables) {
      const err = await db.asErr('anon', null, `select 1 from public.${tablename} limit 1`);
      expect(err?.code, tablename).toBe('42501');
    }
  });
  it('anon cannot write to any public table', async () => {
    const tables = await db.admin<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
    for (const { tablename } of tables) {
      expect((await db.asErr('anon', null, `delete from public.${tablename}`))?.code, tablename).toBe('42501');
      expect((await db.asErr('anon', null, `update public.${tablename} set created_at = now()`))?.code, tablename).toBeDefined();
    }
  });
  it('anon cannot execute any function in public or private', async () => {
    const rows = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','private') and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows).toEqual([]);
  });
  it('anon holds NO privilege of any kind on any table or column (checked in the catalog, not by trying)', async () => {
    const rows = await db.admin<{ tbl: string; priv: string }>(
      `select c.relname tbl, p.priv
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join (values ('select'),('insert'),('update'),('delete'),('truncate'),('references'),('trigger')) p(priv)
        where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S')
          and (has_table_privilege('anon', c.oid, p.priv)
               or (c.relkind <> 'S' and p.priv in ('select','insert','update','references') and has_any_column_privilege('anon', c.oid, p.priv)))`,
    );
    expect(rows).toEqual([]);
  });
  it('anon cannot use the public or private schema', async () => {
    const [r] = await db.admin<{ pub: boolean; priv: boolean }>(`select has_schema_privilege('anon','public','usage') pub, has_schema_privilege('anon','private','usage') priv`);
    expect(r).toEqual({ pub: false, priv: false });
  });
  it('anon cannot use the private schema', async () => {
    expect((await db.asErr('anon', null, `select private.my_role()`))?.code).toBe('42501');
  });
});

describe('function privileges', () => {
  const execBy = async (role: string) =>
    (
      await db.admin<{ proname: string }>(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege('${role}', p.oid, 'execute') order by 1`,
      )
    ).map((r) => r.proname);

  it('guest_* and admin_* are executable by service_role only', async () => {
    const auth = await execBy('authenticated');
    expect(auth.filter((n) => n.startsWith('guest_') || n.startsWith('admin_'))).toEqual([]);
    const svc = await execBy('service_role');
    expect(svc.filter((n) => n.startsWith('guest_')).length).toBeGreaterThanOrEqual(8);
    expect(svc.filter((n) => n.startsWith('admin_')).length).toBeGreaterThanOrEqual(7);
  });
  it('staff_* and mgr_* are executable by authenticated only', async () => {
    const svc = await execBy('service_role');
    expect(svc.filter((n) => n.startsWith('staff_') || n.startsWith('mgr_'))).toEqual([]);
    const auth = await execBy('authenticated');
    expect(auth.filter((n) => n.startsWith('staff_') || n.startsWith('mgr_')).length).toBe(39);
    const svcOnly = await execBy('service_role');
    expect(svcOnly.filter((n) => n.startsWith('owner_')).sort()).toEqual(['owner_add_staff', 'owner_check_staff', 'owner_check_staff_action', 'owner_set_staff']);
    expect(auth.filter((n) => n.startsWith('owner_'))).toEqual([]);
  });
  it('every SECURITY DEFINER function pins search_path to empty', async () => {
    const rows = await db.admin<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','private') and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r.proconfig?.some((c) => c === 'search_path=""'), r.proname).toBe(true);
    }
  });
  it('guests (authenticated users) cannot call the guest functions directly', async () => {
    const err = await db.asErr('authenticated', w.stranger, `select public.guest_get_menu($1)`, [w.A.slug]);
    expect(err?.code).toBe('42501');
  });
  it('service_role has no direct table access (functions only)', async () => {
    for (const t of TENANT_TABLES) {
      expect((await db.asErr('service_role', null, `select 1 from public.${t} limit 1`))?.code, t).toBe('42501');
    }
  });
});

describe('cross-restaurant isolation (staff of B versus data of A)', () => {
  const B = () => w.B;
  const roles = ['owner', 'manager', 'waiter', 'kitchen'] as const;

  it('positive control: A\'s owner sees A\'s rows in every readable table', async () => {
    for (const t of TENANT_TABLES.filter((x) => x !== 'restaurants')) {
      const rows = await db.as<{ n: number }>('authenticated', w.A.owner, `select count(*)::int n from public.${t} where restaurant_id = $1`, [w.A.rid]);
      expect(rows[0]!.n, t).toBeGreaterThan(0);
    }
    const r = await db.as('authenticated', w.A.owner, `select 1 from public.restaurants where id = $1`, [w.A.rid]);
    expect(r.length).toBe(1);
  });

  for (const role of roles) {
    it(`B's ${role} sees zero rows of A in every table`, async () => {
      const uid = B()[role];
      for (const t of TENANT_TABLES.filter((x) => x !== 'restaurants')) {
        const rows = await db.as<{ n: number }>('authenticated', uid, `select count(*)::int n from public.${t} where restaurant_id = $1`, [w.A.rid]);
        expect(rows[0]!.n, `${role}:${t}`).toBe(0);
      }
      const r = await db.as('authenticated', uid, `select 1 from public.restaurants where id = $1`, [w.A.rid]);
      expect(r.length).toBe(0);
    });
  }

  it('a user with no staff row sees nothing at all', async () => {
    for (const t of TENANT_TABLES) {
      const rows = await db.as<{ n: number }>('authenticated', w.stranger, `select count(*)::int n from public.${t}`);
      expect(rows[0]!.n, t).toBe(0);
    }
  });

  it('B\'s owner cannot update or delete A\'s rows (0 rows affected)', async () => {
    const q = async (sql: string, p: unknown[]) => (await db.asTx('authenticated', B().owner, async (x) => x(sql, p))).length;
    const run = (sql: string, p: unknown[]) =>
      db.asTx('authenticated', B().owner, async (x) => {
        const r = await x(`with c as (${sql} returning 1) select count(*)::int n from c`, p);
        return (r[0] as { n: number }).n;
      });
    void q;
    expect(await run(`update public.restaurants set name = 'hacked' where id = $1`, [w.A.rid])).toBe(0);
    expect(await run(`update public.categories set name_en = 'hacked' where restaurant_id = $1`, [w.A.rid])).toBe(0);
    expect(await run(`update public.items set price_paise = 1 where restaurant_id = $1`, [w.A.rid])).toBe(0);
    expect(await run(`update public.dining_tables set label = 'hacked' where restaurant_id = $1`, [w.A.rid])).toBe(0);
    expect(await run(`delete from public.categories where restaurant_id = $1`, [w.A.rid])).toBe(0);
    expect(await run(`delete from public.items where restaurant_id = $1`, [w.A.rid])).toBe(0);
    const [row] = await db.admin<{ name: string }>(`select name from public.restaurants where id = $1`, [w.A.rid]);
    expect(row!.name).toBe('Cafe Aroma Deluxe');
  });

  it('B\'s owner cannot insert rows into A', async () => {
    const e1 = await db.asErr('authenticated', B().owner, `insert into public.categories (restaurant_id, name_en) values ($1, 'x')`, [w.A.rid]);
    expect(e1?.code).toBe('42501');
    const e2 = await db.asErr('authenticated', B().owner, `insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,'x',100)`, [w.A.rid, w.A.catId]);
    expect(e2?.code).toBe('42501');
    const e3 = await db.asErr('authenticated', B().owner, `insert into public.dining_tables (restaurant_id, label) values ($1, '99')`, [w.A.rid]);
    expect(e3?.code).toBe('42501');
  });

  it('B cannot plant an item in B that points at A\'s category (composite FK blocks cross-tenant links)', async () => {
    const err = await db.asErr('authenticated', B().owner, `insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,'x',100)`, [w.B.rid, w.A.catId]);
    expect(err?.code).toBe('23503');
  });

  it('the database itself rejects cross-tenant rows even for a superuser (defence in depth)', async () => {
    const e1 = await db.asErr('authenticated', null, `select 1`); // sanity: harness works
    expect(e1).toBeNull();
    const err = await db.pool
      .query(`insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,'x',100)`, [w.B.rid, w.A.catId])
      .then(() => null, (e: { code: string }) => e.code);
    expect(err).toBe('23503');
    const err2 = await db.pool
      .query(`insert into public.order_items (order_id, restaurant_id, name_en_snapshot, unit_price_paise, qty) values ($1,$2,'x',1,1)`, [orderIdA, w.B.rid])
      .then(() => null, (e: { code: string }) => e.code);
    expect(err2).toBe('23503');
  });

  it('nobody can write to orders / sessions / requests / order_items / review_clicks directly', async () => {
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter, w.A.kitchen]) {
      for (const t of ['orders', 'table_sessions', 'service_requests', 'order_items', 'review_clicks', 'staff', 'audit_log', 'rate_limits', 'platform_admins']) {
        expect((await db.asErr('authenticated', uid, `delete from public.${t}`))?.code, `delete ${t}`).toBe('42501');
        const col = t === 'rate_limits' ? 'count' : t === 'platform_admins' ? 'user_id' : 'restaurant_id';
        expect((await db.asErr('authenticated', uid, `update public.${t} set ${col} = ${col}`))?.code, `update ${t}`).toBe('42501');
      }
      expect((await db.asErr('authenticated', uid, `insert into public.orders (restaurant_id) values ($1)`, [w.A.rid]))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `insert into public.service_requests (restaurant_id) values ($1)`, [w.A.rid]))?.code).toBe('42501');
    }
  });

  it('platform_admins and rate_limits are unreadable by staff', async () => {
    expect((await db.asErr('authenticated', w.A.owner, `select * from public.platform_admins`))?.code).toBe('42501');
    expect((await db.asErr('authenticated', w.A.owner, `select * from public.rate_limits`))?.code).toBe('42501');
  });
});

describe('role permissions on menu, settings and secrets', () => {
  it('kitchen and waiter cannot change prices, add items or edit categories', async () => {
    for (const uid of [w.A.kitchen, w.A.waiter]) {
      const upd = await db.asTx('authenticated', uid, async (q) => q(`with c as (update public.items set price_paise = 1 where id = $1 returning 1) select count(*)::int n from c`, [w.A.paneer]));
      expect((upd[0] as { n: number }).n).toBe(0);
      expect((await db.asErr('authenticated', uid, `insert into public.items (restaurant_id, category_id, name_en, price_paise) values ($1,$2,'x',1)`, [w.A.rid, w.A.catId]))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `insert into public.categories (restaurant_id, name_en) values ($1,'x')`, [w.A.rid]))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `insert into public.dining_tables (restaurant_id, label) values ($1,'77')`, [w.A.rid]))?.code).toBe('42501');
    }
    const [p] = await db.admin<{ price_paise: number }>(`select price_paise from public.items where id = $1`, [w.A.paneer]);
    expect(p!.price_paise).toBe(25000);
  });
  it('manager can edit prices; owner-only settings stay owner-only', async () => {
    await db.as('authenticated', w.A.manager, `update public.items set price_paise = 26000 where id = $1`, [w.A.paneer]);
    const [p] = await db.admin<{ price_paise: number }>(`select price_paise from public.items where id = $1`, [w.A.paneer]);
    expect(p!.price_paise).toBe(26000);
    await db.admin(`update public.items set price_paise = 25000 where id = $1`, [w.A.paneer]);

    const m = await db.asTx('authenticated', w.A.manager, async (q) => q(`with c as (update public.restaurants set name = 'x' where id = $1 returning 1) select count(*)::int n from c`, [w.A.rid]));
    expect((m[0] as { n: number }).n).toBe(0);
    await db.as('authenticated', w.A.owner, `update public.restaurants set accent = 'teal' where id = $1`, [w.A.rid]);
  });
  it('owner cannot change plan, paid_until, status, slug or order_counter (column privileges)', async () => {
    for (const col of ['plan', 'paid_until', 'status', 'slug', 'order_counter']) {
      const val = col === 'paid_until' ? 'now()' : col === 'order_counter' ? '0' : `'x'`;
      const err = await db.asErr('authenticated', w.A.owner, `update public.restaurants set ${col} = ${val} where id = $1`, [w.A.rid]);
      expect(err?.code, col).toBe('42501');
    }
  });
  it('is_available cannot be written directly, even by the owner', async () => {
    const err = await db.asErr('authenticated', w.A.owner, `update public.items set is_available = false where id = $1`, [w.A.paneer]);
    expect(err?.code).toBe('42501');
  });
  it('qr_token is invisible to every role via direct table access', async () => {
    for (const uid of [w.A.owner, w.A.manager, w.A.waiter, w.A.kitchen]) {
      expect((await db.asErr('authenticated', uid, `select qr_token from public.dining_tables`))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `select * from public.dining_tables`))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `update public.dining_tables set qr_token = 'a'`))?.code).toBe('42501');
    }
    const rows = await db.as('authenticated', w.A.waiter, `select id, label from public.dining_tables where restaurant_id = $1`, [w.A.rid]);
    expect(rows.length).toBe(2);
  });
  it('a malicious image_path pointing into another restaurant\'s folder is rejected', async () => {
    const err = await db.asErr('authenticated', w.A.owner, `update public.items set image_path = $2 where id = $1`, [w.A.paneer, `${w.B.rid}/x.webp`]);
    expect(err?.code).toBe('23514');
    const ok = await db.asErr('authenticated', w.A.owner, `update public.items set image_path = $2 where id = $1`, [w.A.paneer, `${w.A.rid}/${'a'.repeat(8)}.webp`]);
    expect(ok).toBeNull();
  });
  it('staff table: a waiter sees only their own row, an owner sees everyone', async () => {
    const own = await db.as('authenticated', w.A.waiter, `select user_id from public.staff`);
    expect(own.map((r) => r.user_id)).toEqual([w.A.waiter]);
    const all = await db.as('authenticated', w.A.owner, `select user_id from public.staff`);
    expect(all.length).toBe(4);
  });
  it('deactivated staff lose all access immediately', async () => {
    await db.admin(`update public.staff set active = false where user_id = $1`, [w.A.waiter]);
    const rows = await db.as<{ n: number }>('authenticated', w.A.waiter, `select count(*)::int n from public.orders`);
    expect(rows[0]!.n).toBe(0);
    const err = await db.asErr('authenticated', w.A.waiter, `select public.staff_resolve_request($1)`, [orderIdA]);
    expect(err?.code).toBe('GM011');
    await db.admin(`update public.staff set active = true where user_id = $1`, [w.A.waiter]);
  });
});

describe('data constraints', () => {
  it('reserved and malformed slugs are rejected', async () => {
    for (const bad of ['admin', 'api', 'login', '_next', 'privacy', 'AB', 'a', 'Has-Caps', 'has space', '-lead', 'trail-', 'dou--ble', 'x'.repeat(41)]) {
      const err = await db.pool.query(`insert into public.restaurants (slug, name) values ($1,'x')`, [bad]).then(() => null, (e: { code: string }) => e.code);
      expect(err, bad).toBe('23514');
    }
    const ok = await db.pool.query(`insert into public.restaurants (slug, name) values ('good-name-1','x')`).then(() => null, (e: { code: string }) => e.code);
    expect(ok).toBeNull();
  });
  it('review_url must be https', async () => {
    for (const bad of ['http://x.com', 'javascript:alert(1)', 'ftp://x', 'https://', 'https://a b']) {
      const err = await db.pool.query(`update public.restaurants set review_url = $1 where id = $2`, [bad, w.A.rid]).then(() => null, (e: { code: string }) => e.code);
      expect(err, bad).toBe('23514');
    }
  });
  it('negative prices, bad diet and bad spice are rejected', async () => {
    for (const [col, val] of [['price_paise', -1], ['diet', "'beef'"], ['spice', 4]] as const) {
      const err = await db.pool.query(`update public.items set ${col} = ${val} where id = $1`, [w.A.paneer]).then(() => null, (e: { code: string }) => e.code);
      expect(err, col).toBe('23514');
    }
  });
});
