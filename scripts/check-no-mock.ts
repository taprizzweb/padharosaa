/**
 * Fails (exit 1) if any active mock/demo record exists (spec 11.3).
 *
 *   CHECK_DATABASE_URL=postgres://... npm run check:no-mock   -> checks that database (run it against PRODUCTION before every release)
 *   npm run check:no-mock                                    -> builds a throw-away database from the migrations (must be clean) and
 *                                                              also checks that the demo seed file would be caught
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createTestDb } from '../supabase/tests/helpers/db';
import { findMock } from './lib-no-mock';

async function main() {
  const url = process.env.CHECK_DATABASE_URL;
  if (url) {
    const client = new Client({ connectionString: url });
    await client.connect();
    const problems = await findMock(client);
    await client.end();
    if (problems.length) {
      console.error('NO-MOCK CHECK FAILED:\n' + problems.map((p) => `  - ${p}`).join('\n'));
      process.exit(1);
    }
    console.log('No-mock check passed: no active demo data in this database.');
    return;
  }
  const db = await createTestDb();
  try {
    const clean = await findMock(db.pool);
    if (clean.length) throw new Error(`fresh database is not clean: ${clean.join('; ')}`);
    await db.pool.query(readFileSync(join(__dirname, '..', 'supabase', 'seed', 'padharoso_demo.sql'), 'utf8'));
    const seeded = await findMock(db.pool);
    if (seeded.length < 4) throw new Error(`the guard missed demo data (found ${seeded.length} problems, expected at least 4)`);
    console.log(`No-mock check passed: a fresh database is clean and the guard catches the demo seed (${seeded.length} findings).`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
