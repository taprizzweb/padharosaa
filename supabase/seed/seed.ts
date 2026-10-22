import type { Pool } from 'pg';
import { DEMO_RESTAURANTS, ROLES } from './data';

export interface SeedOptions {
  /** Creates a login user and returns its id. Local test DB: insert into auth.users. Supabase: Auth admin API. */
  createUser(email: string, displayName: string): Promise<string>;
}

export interface SeedResult {
  restaurants: { slug: string; owner: string; accounts: { role: string; email: string }[]; tables: { label: string; token: string }[] }[];
  admin: string;
}

/** Idempotent: a restaurant whose slug already exists is left untouched. */
export async function seedDemo(pool: Pool, opts: SeedOptions): Promise<SeedResult> {
  const out: SeedResult = { restaurants: [], admin: 'admin@gotomenu.demo' };

  const adminExists = await pool.query(`select 1 from auth.users where email = $1`, [out.admin]);
  if (adminExists.rowCount === 0) {
    const id = await opts.createUser(out.admin, 'Platform admin');
    await pool.query(`insert into public.platform_admins (user_id) values ($1) on conflict do nothing`, [id]);
  }

  for (const r of DEMO_RESTAURANTS) {
    const exists = await pool.query(`select id from public.restaurants where slug = $1`, [r.slug]);
    if (exists.rowCount) continue;
    const { rows: [row] } = await pool.query<{ id: string }>(
      `insert into public.restaurants (slug, name, accent, review_url, plan) values ($1,$2,$3,$4,'pilot') returning id`,
      [r.slug, r.name, r.accent, r.reviewUrl],
    );
    const rid = row!.id;
    const accounts: { role: string; email: string }[] = [];
    for (const role of ROLES) {
      const email = `${role}@${r.slug}.demo`;
      const uid = await opts.createUser(email, `${role[0]!.toUpperCase()}${role.slice(1)} (${r.name})`);
      await pool.query(`insert into public.staff (user_id, restaurant_id, role, display_name) values ($1,$2,$3,$4)`, [uid, rid, role, `${role[0]!.toUpperCase()}${role.slice(1)}`]);
      accounts.push({ role, email });
    }
    let catOrder = 0;
    for (const c of r.categories) {
      const { rows: [cat] } = await pool.query<{ id: string }>(
        `insert into public.categories (restaurant_id, name_en, sort_order) values ($1,$2,$3) returning id`, [rid, c.en, catOrder++]);
      let itemOrder = 0;
      for (const i of c.items) {
        await pool.query(
          `insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice,
                                     is_available, is_bestseller, is_chef_pick, sort_order)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [rid, cat!.id, i.en, i.descEn, Math.round(i.rupees * 100), i.diet, i.spice ?? 0, !i.soldOut, !!i.best, !!i.chef, itemOrder++],
        );
      }
    }
    const tables: { label: string; token: string }[] = [];
    for (let n = 1; n <= r.tables; n++) {
      const { rows: [t] } = await pool.query<{ qr_token: string }>(`insert into public.dining_tables (restaurant_id, label) values ($1,$2) returning qr_token`, [rid, String(n)]);
      tables.push({ label: String(n), token: t!.qr_token });
    }
    out.restaurants.push({ slug: r.slug, owner: accounts[0]!.email, accounts, tables });
  }
  return out;
}

/** Local/test database: users are plain rows in the (stubbed) auth.users table. */
export function localUserCreator(pool: Pool): SeedOptions['createUser'] {
  return async (email) => {
    const { rows: [u] } = await pool.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
    return u!.id;
  };
}
