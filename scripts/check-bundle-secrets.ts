/**
 * Proves server-only secrets did not leak into what browsers download.
 * Scans .next/static (everything served to clients) for:
 *   - the actual values of the server secrets (read from the environment used for the build)
 *   - the secret variable NAMES
 *   - any embedded JWT whose payload says role=service_role
 * Run after `next build`, with the same env vars the build used.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '.next', 'static');
const SECRET_VARS = ['SUPABASE_SERVICE_ROLE_KEY', 'GUEST_COOKIE_SECRET', 'IP_HASH_SALT', 'SENTRY_DSN'];
const FORBIDDEN_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'GUEST_COOKIE_SECRET', 'IP_HASH_SALT'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function main() {
  let files: string[];
  try {
    files = walk(ROOT).filter((f) => /\.(js|css|html|json|map|txt)$/.test(f));
  } catch {
    console.error('No .next/static directory: run `npm run build` first.');
    process.exit(2);
  }
  const values = SECRET_VARS.map((k) => [k, process.env[k]] as const).filter(([, v]) => v && v.length >= 8) as [string, string][];
  if (!values.some(([k]) => k === 'SUPABASE_SERVICE_ROLE_KEY')) {
    console.error('SUPABASE_SERVICE_ROLE_KEY must be set (use a dummy value) so the scan has something to look for.');
    process.exit(2);
  }
  const problems: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const [k, v] of values) if (text.includes(v)) problems.push(`${f}: contains the VALUE of ${k}`);
    for (const n of FORBIDDEN_NAMES) if (text.includes(n)) problems.push(`${f}: contains the name ${n}`);
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{5,}/g)) {
      try {
        const payload = Buffer.from(m[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        if (/service_role/.test(payload)) problems.push(`${f}: contains a JWT with role service_role`);
      } catch {
        /* not a JWT */
      }
    }
  }
  if (problems.length) {
    console.error('SECRET LEAK CHECK FAILED:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  console.log(`Secret leak check passed: scanned ${files.length} client files, no secret values, names or service-role tokens found.`);
}

main();
