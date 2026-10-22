import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, orderErr, placeOrder, rpc, rpcErr, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db.close());

const auditFor = (rid: string, where = '') => db.admin<{ action: string; entity: string; entity_id: string; actor_user_id: string | null; actor_role: string | null; details: Record<string, any> }>(
  `select action, entity, entity_id, actor_user_id, actor_role, details from public.audit_log where restaurant_id = $1 ${where} order by id`, [rid]);

describe('audit log', () => {
  it('records price changes with old and new value, who and role', async () => {
    await db.as('authenticated', w.A.manager, `update public.items set price_paise = 27500 where id = $1`, [w.A.paneer]);
    const rows = await auditFor(w.A.rid, `and entity = 'items' and entity_id = '${w.A.paneer}' and action = 'update'`);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ actor_user_id: w.A.manager, actor_role: 'manager' });
    expect(rows[0]!.details.price_paise).toEqual({ old: 25000, new: 27500 });
    await db.admin(`update public.items set price_paise = 25000 where id = $1`, [w.A.paneer]);
  });
  it('records menu create/delete, settings, tables and staff changes', async () => {
    const [cat] = await db.as<{ id: string }>('authenticated', w.A.owner, `insert into public.categories (restaurant_id, name_en) values ($1,'Desserts') returning id`, [w.A.rid]);
    await db.as('authenticated', w.A.owner, `delete from public.categories where id = $1`, [cat!.id]);
    await db.as('authenticated', w.A.owner, `update public.restaurants set review_url = 'https://g.page/new' where id = $1`, [w.A.rid]);
    await db.as('authenticated', w.A.manager, `update public.dining_tables set label = 'Window' where id = $1`, [w.A.t1.id]);
    await db.admin(`update public.staff set role = 'waiter' where user_id = $1`, [w.A.kitchen]);
    await db.admin(`update public.staff set role = 'kitchen' where user_id = $1`, [w.A.kitchen]);
    const acts = (await auditFor(w.A.rid)).map((r) => `${r.action}:${r.entity}`);
    for (const x of ['insert:categories', 'delete:categories', 'update:restaurants', 'update:dining_tables', 'update:staff']) expect(acts, x).toContain(x);
  });
  it('does not log order-counter noise on every order', async () => {
    const before = (await auditFor(w.A.rid, `and entity = 'restaurants'`)).length;
    const [t] = await db.admin<{ qr_token: string }>(`select qr_token from public.dining_tables where id = $1`, [w.A.t2.id]);
    await placeOrder(db, w.A, { token: t!.qr_token }, [{ item_id: w.A.chai, qty: 1 }]);
    expect((await auditFor(w.A.rid, `and entity = 'restaurants'`)).length).toBe(before);
  });
  it('never writes QR tokens into the log', async () => {
    await db.as('authenticated', w.A.owner, `select public.mgr_create_tables(10, 12)`);
    const tokens = (await db.as<{ qr_token: string }>('authenticated', w.A.owner, `select qr_token from public.mgr_get_table_tokens()`)).map((r) => r.qr_token);
    const [t] = await db.as<{ r: string }>('authenticated', w.A.owner, `select public.mgr_rotate_table_token($1) r`, [w.A.t1.id]);
    tokens.push(t!.r, w.A.t1.token);
    const dump = JSON.stringify(await db.admin(`select * from public.audit_log`));
    for (const tok of tokens) expect(dump).not.toContain(tok);
  });
  it('only owner and manager can read the log, only their own restaurant\'s', async () => {
    const q = (uid: string) => db.as<{ n: number }>('authenticated', uid, `select count(*)::int n from public.audit_log`);
    expect((await q(w.A.owner))[0]!.n).toBeGreaterThan(0);
    expect((await q(w.A.manager))[0]!.n).toBeGreaterThan(0);
    expect((await q(w.A.waiter))[0]!.n).toBe(0);
    expect((await q(w.A.kitchen))[0]!.n).toBe(0);
    const foreign = await db.as<{ n: number }>('authenticated', w.B.owner, `select count(*)::int n from public.audit_log where restaurant_id <> $1`, [w.B.rid]);
    expect(foreign[0]!.n).toBe(0); // B's owner sees only B's own rows
    const leak = await db.as<{ n: number }>('authenticated', w.B.owner, `select count(*)::int n from public.audit_log where restaurant_id = $1`, [w.A.rid]);
    expect(leak[0]!.n).toBe(0);
  });
  it('cannot be updated or deleted: privileges block staff', async () => {
    for (const uid of [w.A.owner, w.A.manager]) {
      expect((await db.asErr('authenticated', uid, `update public.audit_log set action = 'x'`))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `delete from public.audit_log`))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `truncate public.audit_log`))?.code).toBe('42501');
      expect((await db.asErr('authenticated', uid, `insert into public.audit_log (action, entity) values ('fake','x')`))?.code).toBe('42501');
    }
  });
  it('cannot be updated, deleted or truncated even by a superuser: triggers block it', async () => {
    const code = (sql: string) => db.pool.query(sql).then(() => null, (e: { code: string; message: string }) => e.code + ':' + e.message);
    expect(await code(`update public.audit_log set action = 'x'`)).toBe('GM017:audit_log_is_append_only');
    expect(await code(`delete from public.audit_log`)).toBe('GM017:audit_log_is_append_only');
    expect(await code(`truncate public.audit_log`)).toBe('GM017:audit_log_is_append_only');
  });
  it('cannot be forged by staff through the internal writer function', async () => {
    expect((await db.asErr('authenticated', w.A.owner, `select private.write_audit(null,'a','b','c','{}')`))?.code).toBe('42501');
  });
});

describe('QR tokens', () => {
  it('rotating invalidates the old QR immediately and the new one works', async () => {
    const t = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,'R1') returning id, qr_token`, [w.A.rid]);
    const old = t[0]!.qr_token;
    expect(await orderErr(db, w.A, { token: old }, [{ item_id: w.A.chai, qty: 1 }])).toBeNull();
    const [r] = await rpc(db, w.A.manager, `public.mgr_rotate_table_token($1)`, [t[0]!.id]);
    const fresh = (r as { r: string }).r;
    expect(fresh).toMatch(/^[0-9a-f]{64}$/);
    expect(fresh).not.toBe(old);
    expect((await orderErr(db, w.A, { token: old }, [{ item_id: w.A.chai, qty: 1 }]))?.code).toBe('GM002');
    expect(await orderErr(db, w.A, { token: fresh }, [{ item_id: w.A.chai, qty: 1 }])).toBeNull();
    const [m] = await db.as<{ m: Record<string, any> }>('service_role', null, `select public.guest_get_menu($1,$2) m`, [w.A.slug, old]);
    expect(m!.m.token_valid).toBe(false);
  });
  it('tokens are 64 hex chars (>128 bits) and unique', async () => {
    const rows = await db.admin<{ qr_token: string }>(`select qr_token from public.dining_tables`);
    expect(new Set(rows.map((r) => r.qr_token)).size).toBe(rows.length);
    for (const r of rows) expect(r.qr_token).toMatch(/^[0-9a-f]{64}$/);
  });
  it('only owner/manager can read or rotate tokens; other restaurants cannot', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) {
      expect((await rpcErr(db, uid, `* from public.mgr_get_table_tokens()`))?.code).toBeDefined();
    }
    expect((await rpcErr(db, w.A.waiter, `public.mgr_rotate_table_token($1)`, [w.A.t1.id]))?.code).toBe('GM011');
    expect((await rpcErr(db, w.A.kitchen, `public.mgr_rotate_table_token($1)`, [w.A.t1.id]))?.code).toBe('GM011');
    expect((await rpcErr(db, w.B.owner, `public.mgr_rotate_table_token($1)`, [w.A.t1.id]))?.code).toBe('GM012');
    const mine = await db.as<{ table_id: string }>('authenticated', w.B.manager, `select table_id from public.mgr_get_table_tokens()`);
    expect(mine.every((r) => r.table_id !== w.A.t1.id)).toBe(true);
    expect(mine.length).toBe(2);
  });
  it('mgr_create_tables: creates a range, skips existing labels, validates bounds', async () => {
    const [a] = await rpc(db, w.B.owner, `public.mgr_create_tables(1, 5)`);
    expect((a as { r: number }).r).toBe(3); // 1 and 2 already exist
    const [b] = await rpc(db, w.B.owner, `public.mgr_create_tables(1, 5)`);
    expect((b as { r: number }).r).toBe(0);
    for (const [f, t] of [[0, 5], [5, 1], [1, 300], [1, 1000]]) expect((await rpcErr(db, w.B.owner, `public.mgr_create_tables($1,$2)`, [f, t]))?.code, `${f}-${t}`).toBe('GM015');
    expect((await rpcErr(db, w.B.waiter, `public.mgr_create_tables(1, 5)`))?.code).toBe('GM011');
  });
  it('a suspended restaurant cannot rotate or create tables', async () => {
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.B.rid]);
    expect((await rpcErr(db, w.B.owner, `public.mgr_create_tables(50, 51)`))?.code).toBe('GM001');
    expect((await db.asErr('authenticated', w.B.owner, `insert into public.categories (restaurant_id, name_en) values ($1,'x')`, [w.B.rid]))?.code).toBe('42501');
    const upd = await db.asTx('authenticated', w.B.manager, async (q) => q(`with c as (update public.items set price_paise = 1 where id = $1 returning 1) select count(*)::int n from c`, [w.B.paneer]));
    expect((upd[0] as { n: number }).n).toBe(0);
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.B.rid]);
  });
});

describe('platform admin functions', () => {
  const svc = (sql: string, p: unknown[] = []) => db.as('service_role', null, sql, p);
  const svcErr = (sql: string, p: unknown[] = []) => db.asErr('service_role', null, sql, p);
  let newRid: string;
  let ownerId: string;

  it('refuse anyone who is not in platform_admins, including a restaurant owner', async () => {
    expect((await svcErr(`select public.admin_list_restaurants($1)`, [w.A.owner]))?.code).toBe('GM011');
    expect((await svcErr(`select public.admin_set_status($1,$2,'suspended')`, [w.stranger, w.A.rid]))?.code).toBe('GM011');
    expect((await svcErr(`select public.admin_delete_restaurant($1,$2,'cafe-aroma')`, [w.A.owner, w.A.rid]))?.code).toBe('GM011');
    expect((await svcErr(`select public.admin_export_restaurant(null,$1)`, [w.A.rid]))?.code).toBe('GM011');
    const [r] = await db.admin<{ status: string }>(`select status from public.restaurants where id = $1`, [w.A.rid]);
    expect(r!.status).toBe('active');
  });
  it('are not callable by restaurant staff or anon', async () => {
    expect((await db.asErr('authenticated', w.admin, `select public.admin_list_restaurants($1)`, [w.admin]))?.code).toBe('42501');
    expect((await db.asErr('anon', null, `select public.admin_list_restaurants($1)`, [w.admin]))?.code).toBe('42501');
  });
  it('create a restaurant with its owner, and list it', async () => {
    ownerId = randomUUID();
    await db.admin(`insert into auth.users (id, email) values ($1,'new-owner@test.local')`, [ownerId]);
    const [r] = await svc(`select public.admin_create_restaurant($1,'new-bistro','New Bistro',$2,'Priya','standard', now() + interval '30 days') r`, [w.admin, ownerId]) as { r: string }[];
    newRid = r!.r;
    const staff = await db.admin<{ role: string }>(`select role from public.staff where user_id = $1 and restaurant_id = $2`, [ownerId, newRid]);
    expect(staff[0]!.role).toBe('owner');
    const list = await svc(`select * from public.admin_list_restaurants($1)`, [w.admin]) as { slug: string }[];
    expect(list.map((x) => x.slug)).toEqual(expect.arrayContaining(['new-bistro', 'cafe-aroma', 'spice-garden']));
    expect((await auditFor(newRid)).map((a) => a.action)).toContain('restaurant_created');
  });
  it('reject reserved or malformed slugs', async () => {
    for (const bad of ['admin', 'api', 'Bad Slug']) {
      const u = randomUUID();
      await db.admin(`insert into auth.users (id) values ($1)`, [u]);
      expect((await svcErr(`select public.admin_create_restaurant($1,$2,'X',$3,'O')`, [w.admin, bad, u]))?.code, bad).toBe('23514');
    }
  });
  it('suspending blocks guest ordering and staff writes immediately; reactivating restores them', async () => {
    await svc(`select public.admin_set_status($1,$2,'suspended')`, [w.admin, w.A.rid]);
    expect((await orderErr(db, w.A, w.A.t2, [{ item_id: w.A.chai, qty: 1 }]))?.code).toBe('GM001');
    const [o] = await db.admin<{ id: string }>(`select id from public.orders where restaurant_id = $1 and status = 'placed' limit 1`, [w.A.rid]);
    expect((await rpcErr(db, w.A.waiter, `public.staff_set_order_status($1,'preparing')`, [o!.id]))?.code).toBe('GM001');
    expect((await db.asErr('authenticated', w.A.owner, `insert into public.categories (restaurant_id, name_en) values ($1,'x')`, [w.A.rid]))?.code).toBe('42501');
    // reads still work so staff can see why
    const rows = await db.as<{ n: number }>('authenticated', w.A.owner, `select count(*)::int n from public.orders`);
    expect(rows[0]!.n).toBeGreaterThan(0);
    await svc(`select public.admin_set_status($1,$2,'active')`, [w.admin, w.A.rid]);
    expect(await orderErr(db, w.A, w.A.t2, [{ item_id: w.A.chai, qty: 1 }])).toBeNull();
    const acts = (await auditFor(w.A.rid, `and actor_role = 'platform_admin'`)).map((a) => a.action);
    expect(acts.filter((a) => a === 'restaurant_status').length).toBe(2);
  });
  it('rejects an invalid status value', async () => {
    expect((await svcErr(`select public.admin_set_status($1,$2,'banned')`, [w.admin, w.A.rid]))?.code).toBe('23514');
  });
  it('set plan and paid-until', async () => {
    await svc(`select public.admin_set_plan($1,$2,'premium', '2030-01-01')`, [w.admin, newRid]);
    const [r] = await db.admin<{ plan: string; paid_until: Date }>(`select plan, paid_until from public.restaurants where id = $1`, [newRid]);
    expect(r!.plan).toBe('premium');
    expect(r!.paid_until.getUTCFullYear()).toBe(2030);
  });
  it('export contains the restaurant\'s data but no QR tokens, and is audited', async () => {
    const [e] = await svc(`select public.admin_export_restaurant($1,$2) r`, [w.admin, w.A.rid]) as { r: Record<string, any[]> }[];
    expect(e!.r.orders!.length).toBeGreaterThan(0);
    expect(e!.r.items!.length).toBeGreaterThan(0);
    expect(JSON.stringify(e)).not.toContain(w.A.t2.token);
    expect(JSON.stringify(e)).not.toContain('qr_token');
    // nothing from restaurant B
    expect(e!.r.orders!.every((o: any) => o.restaurant_id === w.A.rid)).toBe(true);
    expect((await auditFor(w.A.rid)).map((a) => a.action)).toContain('restaurant_exported');
  });
  it('delete requires the exact slug, removes everything, returns staff ids, keeps a platform-level record', async () => {
    expect((await svcErr(`select public.admin_delete_restaurant($1,$2,'wrong')`, [w.admin, w.B.rid]))?.code).toBe('GM015');
    expect((await svcErr(`select public.admin_delete_restaurant($1,$2,null)`, [w.admin, w.B.rid]))?.code).toBe('GM015');
    // give B some data in every table first
    const t = await db.admin<{ qr_token: string }>(`select qr_token from public.dining_tables where restaurant_id = $1 limit 1`, [w.B.rid]);
    const o = await placeOrder(db, w.B, { token: t[0]!.qr_token }, [{ item_id: w.B.chai, qty: 1 }]);
    await db.as('service_role', null, `select public.guest_create_request($1,'waiter','water')`, [o.session_id]);
    const before = await db.admin<{ n: number }>(`select count(*)::int n from public.audit_log where restaurant_id = $1`, [w.B.rid]);
    expect(before[0]!.n).toBeGreaterThan(0);

    const [r] = await svc(`select public.admin_delete_restaurant($1,$2,'spice-garden') r`, [w.admin, w.B.rid]) as { r: string[] }[];
    expect(r!.r.sort()).toEqual([w.B.owner, w.B.manager, w.B.waiter, w.B.kitchen].sort());
    for (const tbl of ['restaurants', 'staff', 'categories', 'items', 'dining_tables', 'table_sessions', 'orders', 'order_items', 'service_requests', 'review_clicks', 'audit_log']) {
      const col = tbl === 'restaurants' ? 'id' : 'restaurant_id';
      const [n] = await db.admin<{ n: number }>(`select count(*)::int n from public.${tbl} where ${col} = $1`, [w.B.rid]);
      expect(n!.n, tbl).toBe(0);
    }
    const [rec] = await db.admin<{ details: { slug: string } }>(`select details from public.audit_log where action = 'restaurant_deleted' and restaurant_id is null`);
    expect(rec!.details.slug).toBe('spice-garden');
    // restaurant A untouched
    const [a] = await db.admin<{ n: number }>(`select count(*)::int n from public.orders where restaurant_id = $1`, [w.A.rid]);
    expect(a!.n).toBeGreaterThan(0);
    // the purge flag does not stay on: audit rows are protected again
    expect(await db.pool.query(`delete from public.audit_log`).then(() => null, (e: { code: string }) => e.code)).toBe('GM017');
  });
});

describe('storage policies (menu photos)', () => {
  const up = (uid: string, name: string) =>
    db.asErr('authenticated', uid, `insert into storage.objects (bucket_id, name, owner) values ('menu-images', $1, $2)`, [name, uid]);
  const file = (rid: string) => `${rid}/${randomUUID()}.webp`;

  it('bucket is public, images only, 2 MB max', async () => {
    const [b] = await db.admin<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'menu-images'`);
    expect(b!.public).toBe(true);
    expect(Number(b!.file_size_limit)).toBe(2097152);
    expect(b!.allowed_mime_types.sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
  it('owner and manager can upload into their own restaurant folder', async () => {
    expect(await up(w.A.owner, file(w.A.rid))).toBeNull();
    expect(await up(w.A.manager, file(w.A.rid))).toBeNull();
  });
  it('waiter, kitchen and strangers cannot upload at all', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await up(uid, file(w.A.rid)))?.code, uid).toBe('42501');
  });
  it('nobody can write into another restaurant\'s folder or the bucket root', async () => {
    const other = await db.admin<{ id: string }>(`select id from public.restaurants where slug = 'new-bistro'`);
    expect((await up(w.A.owner, file(other[0]!.id)))?.code).toBe('42501');
    expect((await up(w.A.owner, `${randomUUID()}.webp`))?.code).toBe('42501');
    expect((await up(w.A.owner, `${w.A.rid}x/${randomUUID()}.webp`))?.code).toBe('42501');
  });
  it('cannot replace or delete another restaurant\'s files; can manage own', async () => {
    const mine = file(w.A.rid);
    await up(w.A.owner, mine);
    const theirs = file((await db.admin<{ id: string }>(`select id from public.restaurants where slug = 'new-bistro'`))[0]!.id);
    await db.admin(`insert into storage.objects (bucket_id, name) values ('menu-images', $1)`, [theirs]);
    const del = await db.asTx('authenticated', w.A.owner, async (q) => q(`with c as (delete from storage.objects where name = $1 returning 1) select count(*)::int n from c`, [theirs]));
    expect((del[0] as { n: number }).n).toBe(0);
    const upd = await db.asTx('authenticated', w.A.owner, async (q) => q(`with c as (update storage.objects set name = $2 where name = $1 returning 1) select count(*)::int n from c`, [theirs, file(w.A.rid)]));
    expect((upd[0] as { n: number }).n).toBe(0);
    const delMine = await db.asTx('authenticated', w.A.manager, async (q) => q(`with c as (delete from storage.objects where name = $1 returning 1) select count(*)::int n from c`, [mine]));
    expect((delMine[0] as { n: number }).n).toBe(1);
    // moving own file into another restaurant's folder is refused (WITH CHECK)
    await up(w.A.owner, mine);
    const mv = await db.asErr('authenticated', w.A.owner, `update storage.objects set name = $2 where name = $1`, [mine, theirs + 'x']);
    expect(mv?.code).toBe('42501');
  });
  it('a suspended restaurant cannot upload', async () => {
    await db.admin(`update public.restaurants set status = 'suspended' where id = $1`, [w.A.rid]);
    expect((await up(w.A.owner, file(w.A.rid)))?.code).toBe('42501');
    await db.admin(`update public.restaurants set status = 'active' where id = $1`, [w.A.rid]);
  });
  it('anon cannot touch storage objects', async () => {
    expect((await db.asErr('anon', null, `select * from storage.objects`))?.code).toBe('42501');
  });
});
