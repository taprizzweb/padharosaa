/**
 * Starts the local stack (real Postgres + REST adapter + built Next.js app), runs Playwright, tears everything down.
 *   npm run test:e2e                 build + run
 *   E2E_SKIP_BUILD=1 npm run test:e2e   reuse the existing build
 *   npm run test:e2e -- -g "thank"   extra args go to Playwright
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const INFO = '/tmp/gotomenu-e2e-stack.json';
const PORT = process.env.E2E_PORT ?? '3100';
const SHIM = process.env.SHIM_PORT ?? '54321';
const children: ChildProcess[] = [];

const start = (cmd: string, args: string[], env: Record<string, string | undefined> = {}) => {
  const c = spawn(cmd, args, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  children.push(c);
  return c;
};
const stopAll = () => {
  for (const c of children) {
    try {
      process.kill(-c.pid!, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
};
const wait = async (ok: () => Promise<boolean>, what: string, seconds = 180) => {
  for (let i = 0; i < seconds; i++) {
    if (await ok().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${what}`);
};

(async () => {
  let code = 1;
  try {
    rmSync(INFO, { force: true });
    start('node_modules/.bin/tsx', ['scripts/dev-stack.ts'], { DEV_STACK_INFO: INFO, SHIM_PORT: SHIM });
    await wait(async () => existsSync(INFO), 'dev stack');
    start('scripts/start-app-local.sh', [], { PORT, SHIM_PORT: SHIM, SKIP_BUILD: process.env.E2E_SKIP_BUILD ?? '' });
    await wait(async () => (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok, 'app health');
    code = await new Promise<number>((resolve) => {
      const p = spawn('node_modules/.bin/playwright', ['test', ...process.argv.slice(2)], {
        env: { ...process.env, E2E_BASE_URL: `http://localhost:${PORT}`, DEV_STACK_INFO: INFO },
        stdio: 'inherit',
      });
      p.on('exit', (c) => resolve(c ?? 1));
    });
  } catch (e) {
    console.error(String(e));
  } finally {
    stopAll();
    await new Promise((r) => setTimeout(r, 1500));
  }
  process.exit(code);
})();
