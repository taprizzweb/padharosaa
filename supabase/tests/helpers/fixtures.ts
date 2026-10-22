import { randomUUID } from 'node:crypto';
import type { TestDb } from './db';

export interface Tenant {
  rid: string;
  slug: string;
  owner: string;
  manager: string;
  waiter: string;
  kitchen: string;
  catId: string;
  paneer: string; // Rs 250, available
  chai: string; // Rs 30, available
  soldOut: string; // Rs 100, NOT available
  platter: string; // Rs 2000
  t1: { id: string; token: string; label: string };
  t2: { id: string; token: string; label: string };
}

export interface World {
  A: Tenant;
  B: Tenant;
  admin: string;
  stranger: string; // authenticated user with no staff row
}

async function user(db: TestDb, label: string): Promise<string> {
  const id = randomUUID();
  await db.admin(`insert into auth.users (id, email) values ($1, $2)`, [id, `${label}-${id.slice(0, 8)}@test.local`]);
  return id;
}

async function tenant(db: TestDb, slug: string, name: string): Promise<Tenant> {
  const [r] = await db.admin<{ id: string }>(`insert into public.restaurants (slug, name, review_url) values ($1, $2, $3) returning id`, [
    slug,
    name,
    `https://g.page/r/${slug}/review`,
  ]);
  const rid = r!.id;
  const owner = await user(db, `${slug}-owner`);
  const manager = await user(db, `${slug}-manager`);
  const waiter = await user(db, `${slug}-waiter`);
  const kitchen = await user(db, `${slug}-kitchen`);
  for (const [uid, role] of [
    [owner, 'owner'],
    [manager, 'manager'],
    [waiter, 'waiter'],
    [kitchen, 'kitchen'],
  ] as const) {
    await db.admin(`insert into public.staff (user_id, restaurant_id, role, display_name) values ($1,$2,$3,$4)`, [uid, rid, role, `${role} ${slug}`]);
  }
  const [c] = await db.admin<{ id: string }>(`insert into public.categories (restaurant_id, name_en, name_hi) values ($1,'Mains','मुख्य व्यंजन') returning id`, [rid]);
  const catId = c!.id;
  const item = async (en: string, hi: string, price: number, available = true) =>
    (
      await db.admin<{ id: string }>(
        `insert into public.items (restaurant_id, category_id, name_en, name_hi, price_paise, is_available) values ($1,$2,$3,$4,$5,$6) returning id`,
        [rid, catId, en, hi, price, available],
      )
    )[0]!.id;
  const paneer = await item('Paneer Butter Masala', 'पनीर बटर मसाला', 25000);
  const chai = await item('Masala Chai', 'मसाला चाय', 3000);
  const soldOut = await item('Dal Makhani', 'दाल मखनी', 10000, false);
  const platter = await item('Party Platter', 'पार्टी थाली', 200000);
  const table = async (label: string) => {
    const [t] = await db.admin<{ id: string; qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning id, qr_token`, [rid, label]);
    return { id: t!.id, token: t!.qr_token, label };
  };
  return { rid, slug, owner, manager, waiter, kitchen, catId, paneer, chai, soldOut, platter, t1: await table('1'), t2: await table('2') };
}

export async function buildWorld(db: TestDb): Promise<World> {
  const A = await tenant(db, 'cafe-aroma', 'Cafe Aroma');
  const B = await tenant(db, 'spice-garden', 'Spice Garden');
  const admin = await user(db, 'admin');
  await db.admin(`insert into public.platform_admins (user_id) values ($1)`, [admin]);
  const stranger = await user(db, 'stranger');
  return { A, B, admin, stranger };
}

export type Line = { item_id: string; qty: number; note?: string; [k: string]: unknown };

export interface PlaceResult {
  order_id: string;
  order_no: number;
  total_paise: number;
  session_id: string;
  table_label: string;
  status: string;
  replayed: boolean;
}

export async function placeOrder(
  db: TestDb,
  t: Tenant,
  table: { token: string },
  items: Line[],
  opts: { note?: string | null; idem?: string; ip?: string | null; slug?: string } = {},
): Promise<PlaceResult> {
  const rows = await db.as<{ r: PlaceResult }>(
    'service_role',
    null,
    `select public.guest_place_order($1,$2,$3::jsonb,$4,$5,$6) as r`,
    [opts.slug ?? t.slug, table.token, JSON.stringify(items), opts.note ?? null, opts.idem ?? randomUUID(), opts.ip ?? null],
  );
  return rows[0]!.r;
}

export async function orderErr(
  db: TestDb,
  t: Tenant,
  table: { token: string },
  items: Line[],
  opts: { note?: string | null; idem?: string; ip?: string | null; slug?: string } = {},
) {
  return db.asErr('service_role', null, `select public.guest_place_order($1,$2,$3::jsonb,$4,$5,$6)`, [
    opts.slug ?? t.slug,
    table.token,
    JSON.stringify(items),
    opts.note ?? null,
    opts.idem ?? randomUUID(),
    opts.ip ?? null,
  ]);
}

/** Staff RPC helper: runs `select <call>` as an authenticated user. */
export function rpc(db: TestDb, uid: string, call: string, params: unknown[] = []) {
  return db.as('authenticated', uid, `select ${call} as r`, params);
}
export function rpcErr(db: TestDb, uid: string, call: string, params: unknown[] = []) {
  return db.asErr('authenticated', uid, `select ${call}`, params);
}
