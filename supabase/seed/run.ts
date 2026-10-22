/**
 * Loads the two demo restaurants into a REAL Supabase project (staging). Never run against production.
 *
 *   SEED_DATABASE_URL=postgres://postgres:<db-password>@db.<ref>.supabase.co:5432/postgres \
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
 *   SEED_STAFF_PASSWORD='<at least 12 characters>' npm run seed
 *
 * Idempotent: restaurants that already exist are skipped. Staff logins are created through Supabase Auth
 * (so passwords are hashed by Supabase), then linked to the restaurants.
 */
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { seedDemo } from './seed';

async function main() {
  const dbUrl = process.env.SEED_DATABASE_URL;
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.SEED_STAFF_PASSWORD;
  if (!dbUrl || !apiUrl || !key || !password || password.length < 12) {
    throw new Error('Set SEED_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SEED_STAFF_PASSWORD (12+ characters). See the comment at the top of this file.');
  }
  if (/prod/i.test(apiUrl) || process.env.SEED_I_AM_SURE_THIS_IS_STAGING !== 'yes') {
    throw new Error('Refusing to seed: set SEED_I_AM_SURE_THIS_IS_STAGING=yes to confirm this is the STAGING project (demo data must never go to production).');
  }
  const admin = createClient(apiUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const result = await seedDemo(pool, {
    createUser: async (email, displayName) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
      if (error || !data.user) throw new Error(`could not create ${email}: ${error?.message}`);
      return data.user.id;
    },
  });
  await pool.end();
  console.log(JSON.stringify({ created: result.restaurants.map((r) => ({ slug: r.slug, logins: r.accounts.map((a) => a.email), tables: r.tables.length })) }, null, 2));
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
