/**
 * Dependency audit gate.
 *  1. Anything that ships to production (npm audit --omit=dev): ANY high/critical finding fails.
 *  2. Development tooling: high/critical findings fail unless the package is on the reviewed allow-list
 *     below (build-time tools that only ever read our own files; reasons recorded in docs/DEPENDENCIES.md).
 */
import { spawnSync } from 'node:child_process';

type Vuln = { severity: string; name: string; isDirect: boolean };
const SEVERE = new Set(['high', 'critical']);

// Reviewed and accepted: dev-only, no patched version exists (braces) or the fix needs a forbidden major
// (Tailwind 4 / Next 16). None of these run in production or see untrusted input.
const ACCEPTED_DEV = new Set([
  'braces', 'micromatch', 'chokidar', 'fast-glob', 'tailwindcss',
  '@next/eslint-plugin-next', 'eslint-config-next', 'postcss',
]);

function audit(extra: string[]): Record<string, Vuln> {
  const r = spawnSync('npm', ['audit', '--json', ...extra], { encoding: 'utf8' });
  return (JSON.parse(r.stdout || '{}').vulnerabilities ?? {}) as Record<string, Vuln>;
}

const prod = Object.values(audit(['--omit=dev'])).filter((v) => SEVERE.has(v.severity));
const all = Object.values(audit([])).filter((v) => SEVERE.has(v.severity));
const unexpectedDev = all.filter((v) => !ACCEPTED_DEV.has(v.name) && !prod.some((p) => p.name === v.name));

if (prod.length || unexpectedDev.length) {
  if (prod.length) console.error('PRODUCTION dependency vulnerabilities:\n' + prod.map((v) => `  - ${v.name} (${v.severity})`).join('\n'));
  if (unexpectedDev.length) console.error('NEW dev-tool vulnerabilities (review, fix, or add to the allow-list with a reason):\n' + unexpectedDev.map((v) => `  - ${v.name} (${v.severity})`).join('\n'));
  process.exit(1);
}
const accepted = all.filter((v) => ACCEPTED_DEV.has(v.name)).map((v) => v.name);
console.log(`Audit passed: 0 high/critical in production dependencies. Accepted dev-only: ${accepted.length ? accepted.join(', ') : 'none'}.`);
