import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './helpers/db';
import { buildWorld, type World } from './helpers/fixtures';

let db: TestDb;
let w: World;
let keyA: string;
let sessA: string;

const set = (uid: string, a: Partial<Record<string, unknown>> = {}) => {
  const v = { p_brand_color: '#0d9488', p_logo_path: 'logos/a.webp', p_logo_crop: null, p_hero_path: 'hero/a.webp', p_hero_crop: { zoom: 1.4, x: 0.5, y: 0.3, aspect: '16:9' },
    p_instagram: '@haveli.rajmahal', p_google: 'https://search.google.com/local/writereview?placeid=ChIJabc123456', p_tripadvisor: 'https://www.tripadvisor.in/Hotel_Review-g1-d2-Reviews-Haveli.html', p_menu: 'https://menu.taprizz.in/haveli-rajmahal', ...a };
  return db.as('authenticated', uid, `select public.padh_set_branding($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8,$9)`, [v.p_brand_color, v.p_logo_path, JSON.stringify(v.p_logo_crop), v.p_hero_path, JSON.stringify(v.p_hero_crop), v.p_instagram, v.p_google, v.p_tripadvisor, v.p_menu] as never);
};
const setErr = (uid: string, a: Partial<Record<string, unknown>> = {}) => set(uid, a).then(() => null, (e) => ({ code: (e as { code?: string }).code }));
const svc = async <T = any>(fn: string, args: unknown[]): Promise<T> =>
  (await db.as('service_role', null, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as r`, args as never))[0]!.r as T;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
  const en = await svc<any>('padh_admin_enable_hotel', [w.admin, w.A.rid, 'Asia/Kolkata']);
  keyA = en.qr_key;
  await svc('padh_admin_enable_hotel', [w.admin, w.B.rid, 'Asia/Kolkata']);
  const room = (await db.admin<{ id: string }>(`insert into public.rooms (restaurant_id, number) values ($1,'204') returning id`, [w.A.rid]))[0]!.id;
  sessA = (await db.admin<{ id: string }>(`insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, token_hash) values ($1,$2,'Guest One','+91','\\x01','\\x02',$3) returning id`, [w.A.rid, room, Buffer.from(randomUUID())]))[0]!.id;
});
afterAll(async () => db.close());

describe('branding and links', () => {
  it('owner and manager can set them; the guest login page then carries the look, never any link or phone', async () => {
    await set(w.A.manager);
    const pub = await svc<any>('padh_public_hotel', [w.A.slug, keyA]);
    expect(pub).toMatchObject({ brand_color: '#0d9488', logo_path: 'logos/a.webp', hero_path: 'hero/a.webp', hero_crop: { zoom: 1.4, aspect: '16:9' } });
    expect(JSON.stringify(pub)).not.toMatch(/instagram|tripadvisor|google|phone|menu\.taprizz/i);
    await set(w.A.owner, { p_brand_color: '#B05545' });
    expect((await svc<any>('padh_public_hotel', [w.A.slug, keyA])).brand_color).toBe('#b05545'); // stored lower-case
  });

  it('a logged-in guest gets the links; Instagram becomes a full link', async () => {
    await set(w.A.manager);
    const l = await svc<any>('padh_guest_links', [sessA]);
    expect(l).toMatchObject({ instagram_url: 'https://www.instagram.com/haveli.rajmahal', menu_url: 'https://menu.taprizz.in/haveli-rajmahal' });
    expect(l.google_review_url).toMatch(/^https:\/\/search\.google\.com\//);
    expect(l.tripadvisor_url).toMatch(/^https:\/\/www\.tripadvisor\.in\//);
    expect((await db.asErr('service_role', null, `select public.padh_guest_links($1)`, [randomUUID()]))?.code).toBe('GM009');
  });

  it('only owner and manager; other staff, strangers and Lite restaurants are refused', async () => {
    for (const uid of [w.A.waiter, w.A.kitchen, w.stranger]) expect((await setErr(uid))?.code, uid).toBe('GM011');
    await db.admin(`insert into public.restaurants (slug, name) values ('lite-x','Lite')`);
    // a manager of a Lite restaurant (no hotel_settings row) is refused too
    const lid = (await db.admin<{ id: string }>(`select id from public.restaurants where slug = 'lite-x'`))[0]!.id;
    const u = (await db.admin<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), 'lite@test.local') returning id`))[0]!.id;
    await db.admin(`insert into public.staff (user_id, restaurant_id, role, display_name) values ($1,$2,'manager','Lite Manager')`, [u, lid]);
    expect((await setErr(u))?.code).toBe('GM011');
  });

  it('rejects bad colours, unsafe or foreign links and malformed crops', async () => {
    const bad: Record<string, unknown>[] = [
      { p_brand_color: 'red' }, { p_brand_color: '#12345' }, { p_brand_color: '#ff0000;background:url(x)' },
      { p_instagram: 'not a handle!' }, { p_instagram: '@a/b' },
      { p_google: 'http://search.google.com/x' }, { p_google: 'https://evil.example/writereview' },
      { p_tripadvisor: 'https://evil.example/tripadvisor.in/x' }, { p_tripadvisor: 'javascript:alert(1)' },
      { p_menu: 'https://evil.example/x' }, { p_menu: 'https://menu.taprizz.in.evil.example/x' }, { p_menu: 'http://menu.taprizz.in/x' },
      { p_hero_crop: { zoom: 9, x: 0.5, y: 0.5, aspect: '16:9' } }, { p_hero_crop: { zoom: 1, x: 2, y: 0.5, aspect: '16:9' } }, { p_hero_crop: { zoom: 1, x: 0.5, y: 0.5, aspect: '2:1' } },
      { p_hero_crop: { zoom: 1, x: 0.5, y: 0.5, aspect: '1:1', script: '<x>' } }, { p_logo_crop: { zoom: 1, x: 0.5, y: 0.5, aspect: '1:1', brightness: 3 } },
    ];
    for (const a of bad) expect((await setErr(w.A.manager, a))?.code, JSON.stringify(a)).toBe('GM015');
    // a good one with the optional adjustments still passes
    await set(w.A.manager, { p_logo_crop: { zoom: 1.2, x: 0.4, y: 0.6, aspect: '1:1', brightness: 1.1, contrast: 0.9 } });
  });

  it('is isolated per hotel and audited; clearing a setting works with nulls', async () => {
    await set(w.A.manager, { p_brand_color: '#0d9488' });
    await set(w.B.manager, { p_brand_color: '#7c3aed', p_instagram: null, p_google: null, p_tripadvisor: null, p_menu: null, p_logo_path: null, p_hero_path: null, p_hero_crop: null });
    const rows = await db.admin<any>(`select restaurant_id, brand_color, menu_url from public.hotel_settings order by brand_color`);
    expect(rows.find((r) => r.restaurant_id === w.A.rid).brand_color).toBe('#0d9488');
    expect(rows.find((r) => r.restaurant_id === w.B.rid)).toMatchObject({ brand_color: '#7c3aed', menu_url: null });
    expect((await db.admin<any>(`select count(*)::int n from public.audit_log where action = 'padh_branding_updated' and restaurant_id = $1`, [w.B.rid]))[0].n).toBe(1);
    expect((await db.admin<any>(`select instagram_url from public.restaurants where id = $1`, [w.B.rid]))[0].instagram_url).toBeNull();
  });

  it('no direct client write, and the brand columns are readable by staff of that hotel only', async () => {
    expect((await db.asErr('authenticated', w.A.owner, `update public.hotel_settings set brand_color = '#000000'`))?.code).toBe('42501');
    const mine = await db.as<any>('authenticated', w.A.waiter, `select restaurant_id, brand_color from public.hotel_settings`);
    expect(mine.every((r) => r.restaurant_id === w.A.rid)).toBe(true);
    expect((await db.asErr('anon', null, `select public.padh_set_branding('#000000',null,null,null,null,null,null,null,null)`))?.code).toBe('42501');
    expect((await db.asErr('service_role', null, `select public.padh_set_branding('#000000',null,null,null,null,null,null,null,null)`))?.code).toBe('42501');
  });
});
