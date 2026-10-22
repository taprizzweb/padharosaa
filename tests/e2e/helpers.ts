import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { callRpc } from '../../supabase/tests/helpers/rpc';
import { DEMO_TOTP_SECRET, totp } from '../../supabase/tests/helpers/totp';

const info = JSON.parse(readFileSync(process.env.DEV_STACK_INFO ?? '/tmp/gotomenu-dev-stack.json', 'utf8')) as { db: string };
const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://gm_test:gm_test@127.0.0.1:5432/postgres');
url.pathname = `/${info.db}`;
export const pool = new Pool({ connectionString: url.toString(), max: 4 });

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

/** A brand-new table (own QR token) so tests never interfere with each other. */
export async function newTable(slug = 'spice-garden'): Promise<{ id: string; token: string; label: string; slug: string }> {
  const label = `E${randomUUID().slice(0, 5)}`;
  const [r] = await q<{ id: string; qr_token: string }>(
    `insert into public.dining_tables (restaurant_id, label) select id, $2 from public.restaurants where slug = $1 returning id, qr_token`,
    [slug, label],
  );
  return { id: r!.id, token: r!.qr_token, label, slug };
}

/** Act as a staff member of a restaurant, exactly as the staff app will (authenticated role + user id). */
export async function staff(email: string, fn: string, args: Record<string, unknown>) {
  const [u] = await q<{ id: string }>(`select id from auth.users where email = $1`, [email]);
  const r = await callRpc(pool, 'authenticated', fn, args, u!.id);
  if (r.error) throw new Error(`${fn}: ${r.error.code} ${r.error.message}`);
  return r.data;
}

export const sessionOf = async (tableId: string) =>
  (await q<{ id: string }>(`select id from public.table_sessions where table_id = $1 order by opened_at desc limit 1`, [tableId]))[0]?.id;
export const ordersOf = (tableId: string) =>
  q<{ id: string; order_no: number; status: string; total_paise: number; note: string | null }>(`select id, order_no, status, total_paise, note from public.orders where table_id = $1 order by created_at`, [tableId]);

/** Closes every open table of a restaurant so a test starts from an empty live board (other tests leave orders behind). */
export async function clearBoard(slug = 'spice-garden'): Promise<void> {
  await q(
    `update public.table_sessions set closed_at = now(), close_reason = 'forced'
      where closed_at is null and restaurant_id = (select id from public.restaurants where slug = $1)`,
    [slug],
  );
}

/** After submitting the sign-in form: owners, managers and admins are asked for their authenticator code (demo accounts share a known secret). */
export async function completeSignIn(page: Page, secret = DEMO_TOTP_SECRET, landing: RegExp = /\/staff$/): Promise<void> {
  await page.waitForURL(/\/(staff|admin|account\/mfa)(\?.*)?$/);
  if (page.url().includes('/account/mfa')) {
    await page.getByLabel('6-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await page.waitForURL(landing);
}
