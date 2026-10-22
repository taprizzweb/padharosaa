/**
 * Fails (exit 1) if any table in the `public` schema does not have Row Level Security enabled,
 * or if `anon` holds any privilege on a public table.
 *
 *   npm run check:rls                                  -> builds a throw-away Postgres DB from the migrations and checks it
 *   CHECK_DATABASE_URL=postgres://... npm run check:rls -> checks an existing database (e.g. staging)
 */
import { Client } from 'pg';
import { createTestDb } from '../supabase/tests/helpers/db';

async function check(client: Pick<Client, 'query'>): Promise<string[]> {
  const problems: string[] = [];
  const noRls = await client.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1`,
  );
  for (const r of noRls.rows) problems.push(`table public.${r.relname} has Row Level Security DISABLED`);

  const anon = await client.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p','v','m')
        and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
             or has_any_column_privilege('anon', c.oid, 'select,insert,update,references')) order by 1`,
  );
  for (const r of anon.rows) problems.push(`role anon has privileges on public.${r.relname}`);

  const count = await client.query<{ n: number }>(`select count(*)::int n from pg_tables where schemaname = 'public'`);
  if ((count.rows[0]?.n ?? 0) === 0) problems.push('no tables found in public (wrong database?)');
  else console.log(`checked ${count.rows[0]!.n} tables in public`);
  return problems;
}

async function main() {
  let problems: string[];
  const url = process.env.CHECK_DATABASE_URL;
  if (url) {
    const client = new Client({ connectionString: url });
    await client.connect();
    problems = await check(client);
    await client.end();
  } else {
    const db = await createTestDb();
    try {
      problems = await check(db.pool);
    } finally {
      await db.close();
    }
  }
  if (problems.length) {
    console.error('RLS CHECK FAILED:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log('RLS check passed: every public table has RLS enabled and anon has no table privileges.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
