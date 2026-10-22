/**
 * Builds nothing; starts an ALREADY BUILT app (`next start`) on a test port, waits until it answers,
 * runs the given command against it, then stops the server. Usage:
 *   tsx scripts/with-server.ts -- vitest run --project http
 */
import { spawn } from 'node:child_process';

const PORT = process.env.TEST_PORT ?? '3100';
const sep = process.argv.indexOf('--');
const cmd = process.argv.slice(sep + 1);
if (sep < 0 || cmd.length === 0) {
  console.error('usage: with-server.ts -- <command...>');
  process.exit(2);
}

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production' as const,
  PORT,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://testproject.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'test-anon-key-test-anon-key-test',
  NEXT_PUBLIC_APP_ORIGIN: process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://gotomenu.taprizz.in',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key-test-service-role',
  GUEST_COOKIE_SECRET: process.env.GUEST_COOKIE_SECRET ?? 'test-cookie-secret-test-cookie-secret-123456',
  IP_HASH_SALT: process.env.IP_HASH_SALT ?? 'test-ip-salt-test-ip-salt',
};

// detached => own process group, so we can stop the server AND anything it spawned (npx would leave an orphan).
const server = spawn('node_modules/.bin/next', ['start', '-p', PORT, '-H', '127.0.0.1'], { env, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
let exited = false;
server.on('exit', () => (exited = true));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error('server exited early');
    try {
      await fetch(`http://127.0.0.1:${PORT}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('server did not start in 30s');
}

(async () => {
  let code = 1;
  try {
    await waitUp();
    code = await new Promise<number>((resolve) => {
      const p = spawn(cmd[0]!, cmd.slice(1), { env: { ...env, TEST_BASE_URL: `http://127.0.0.1:${PORT}` }, stdio: 'inherit' });
      p.on('exit', (c) => resolve(c ?? 1));
    });
  } catch (e) {
    console.error(String(e));
  } finally {
    try {
      process.kill(-server.pid!, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
})();
