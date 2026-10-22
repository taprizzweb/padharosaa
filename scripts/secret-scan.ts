/** Scans every git-tracked file for things that look like real secrets. Exit 1 if any are found. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS: [string, RegExp][] = [
  ['JWT / Supabase key', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Stripe/Razorpay live key', /(?:sk_live|rzp_live)_[A-Za-z0-9]{10,}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['Sentry DSN with key', /https:\/\/[0-9a-f]{20,}@[a-z0-9.]+\.ingest\.sentry\.io/],
  ['Postgres URL with password', /postgres(?:ql)?:\/\/[^:\s/]+:(?!gm_test@|\$|<)[^@\s]{6,}@(?!127\.0\.0\.1|localhost)/],
];
const SKIP = [/^package-lock\.json$/, /^\.env\.example$/];

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const hits: string[] = [];
for (const f of files) {
  if (SKIP.some((r) => r.test(f))) continue;
  let text: string;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${f}: looks like a ${name}`);
}
if (hits.length) {
  console.error('SECRET SCAN FAILED:\n' + hits.map((h) => `  - ${h}`).join('\n'));
  process.exit(1);
}
console.log(`Secret scan passed: ${files.length} files checked, nothing that looks like a real secret.`);
