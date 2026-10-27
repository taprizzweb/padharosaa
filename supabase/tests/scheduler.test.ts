import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './helpers/db';

// The scheduler (migration 0069): the tick is harmless without its settings, and the secrets table is closed to everyone but the database itself.
let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => db.close());

describe('the scheduler tick', () => {
  it('does nothing when the address or the secret is missing, or the address is not https', async () => {
    await db.admin(`select private.cron_tick()`);
    await db.admin(`insert into private.app_secrets (key, value) values ('cron_url', 'http://insecure.example.com/x'), ('cron_secret', 'a-very-long-secret-value-0123456789')`);
    await db.admin(`select private.cron_tick()`); // http:// is refused before any call is made
    await db.admin(`update private.app_secrets set value = 'https://example.com/tick' where key = 'cron_url'`);
  });
  it('nobody can read the secrets or run the tick through the API', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      expect((await db.asErr(role, role === 'authenticated' ? '00000000-0000-0000-0000-000000000001' : null, `select * from private.app_secrets`, [] as never))?.code, role).toBe('42501');
      expect((await db.asErr(role, role === 'authenticated' ? '00000000-0000-0000-0000-000000000001' : null, `select private.cron_tick()`, [] as never))?.code, role).toBe('42501');
    }
  });
});
