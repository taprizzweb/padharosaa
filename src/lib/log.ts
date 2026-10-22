/** Structured JSON logs. Secrets, QR tokens, cookies and raw IPs must never be passed in; keys that look sensitive are redacted anyway. */
const REDACT = /token|secret|password|cookie|authorization|key|ip$/i;
const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof order;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.test(k) ? '[redacted]' : scrub(x, depth + 1)]));
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const min = (process.env.LOG_LEVEL as Level | undefined) ?? 'info';
  if (order[level] < (order[min] ?? 20)) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(scrub(fields) as object) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.error)(line);
}
