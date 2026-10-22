import { Client, Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://gm_test:gm_test@127.0.0.1:5432/postgres';
const ROOT = join(__dirname, '..', '..');

export type Role = 'anon' | 'authenticated' | 'service_role';

export interface TestDb {
  name: string;
  pool: Pool;
  /** assurance level put in the test user's token: 'aal2' (password + second factor) unless a test lowers it */
  aal: 'aal1' | 'aal2';
  /** Run SQL as the superuser (setup / inspection). */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run SQL as a database role, optionally impersonating an auth user, in its own transaction. */
  as<T = Record<string, unknown>>(role: Role, userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Same as `as`, but resolves to the error instead of throwing. */
  asErr(role: Role, userId: string | null, sql: string, params?: unknown[]): Promise<{ code?: string; message: string } | null>;
  /** Several statements in one transaction as one role/user; rolls back at the end. */
  asTx<T>(role: Role, userId: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function urlFor(db: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function migrationFiles(): Promise<{ name: string; sql: string }[]> {
  const dir = join(ROOT, 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), 'utf8') }));
}

export async function createTestDb(opts: { migrate?: boolean } = {}): Promise<TestDb> {
  const name = `gm_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const root = new Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();

  const pool = new Pool({ connectionString: urlFor(name), max: 20 });
  // dropping the database at the end can cut idle connections; that is expected and must not fail a test run
  pool.on('error', () => undefined);
  await pool.query(readFileSync(join(__dirname, 'supabase_stub.sql'), 'utf8'));
  if (opts.migrate !== false) {
    for (const m of await migrationFiles()) {
      try {
        await pool.query(m.sql);
      } catch (e) {
        throw new Error(`migration ${m.name} failed: ${(e as Error).message}`);
      }
    }
  }

  async function withRole<T>(role: Role, userId: string | null, fn: (c: import('pg').PoolClient) => Promise<T>, commit: boolean): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`set local role ${role}`);
      if (userId) {
        await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
          JSON.stringify({ sub: userId, role, aal: db.aal }),
          userId,
        ]);
      }
      const out = await fn(c);
      await c.query(commit ? 'commit' : 'rollback');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  const db: TestDb = {
    name,
    aal: 'aal2',
    pool,
    async admin(sql, params) {
      const r = await pool.query(sql, params as unknown[]);
      return r.rows;
    },
    as(role, userId, sql, params) {
      return withRole(role, userId, async (c) => (await c.query(sql, params as unknown[])).rows, true);
    },
    async asErr(role, userId, sql, params) {
      try {
        await withRole(role, userId, (c) => c.query(sql, params as unknown[]), true);
        return null;
      } catch (e) {
        const err = e as { code?: string; message: string };
        return { code: err.code, message: err.message };
      }
    },
    asTx(role, userId, fn) {
      return withRole(role, userId, (c) => fn(async (sql, params) => (await c.query(sql, params as unknown[])).rows), false);
    },
    async close() {
      await pool.end();
      const r = new Client({ connectionString: ADMIN_URL });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    },
  };
  return db;
}
