/**
 * Minimal server-side error reporting to Sentry (no SDK: nothing is added to the browser bundle and nothing is sent unless
 * SENTRY_DSN is set). Only the error type, a scrubbed message and stack, the request id and the route are sent.
 * Never sent: cookies, headers, request bodies, IP addresses, emails, phone numbers, tokens or passwords.
 * Not covered: errors that happen inside the visitor's browser (see docs/OPERATIONS.md).
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g; // QR tokens, JWTs, keys
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const PHONE = /(?:\+?\d[\d\s-]{8,}\d)/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function scrubText(s: string, max = 2000): string {
  return s.replace(JWT, '[token]').replace(EMAIL, '[email]').replace(UUID, '[id]').replace(LONG_TOKEN, '[token]').replace(PHONE, '[number]').slice(0, max);
}

export interface Parsed { key: string; host: string; project: string }
export function parseDsn(dsn: string): Parsed | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\//, '');
    if (!u.username || !project || u.protocol !== 'https:') return null;
    return { key: u.username, host: u.host, project };
  } catch {
    return null;
  }
}

export function buildEvent(err: unknown, ctx: { requestId?: string; route?: string }, now = new Date()) {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: now.toISOString(),
    platform: 'node',
    level: 'error',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    tags: { request_id: ctx.requestId ?? 'none', route: ctx.route ? scrubText(ctx.route, 120) : 'unknown' },
    exception: { values: [{ type: e.name.slice(0, 60), value: scrubText(e.message), stacktrace: undefined }] },
    extra: { stack: e.stack ? scrubText(e.stack, 3000) : undefined },
  };
}

let windowStart = 0;
let sent = 0;
const MAX_PER_MINUTE = 20; // a failure storm must not become a flood (or a bill)

/** Fire-and-forget: never throws and never slows the request. */
export function captureError(err: unknown, ctx: { requestId?: string; route?: string } = {}): void {
  const dsn = process.env.SENTRY_DSN ? parseDsn(process.env.SENTRY_DSN) : null;
  if (!dsn) return;
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; sent = 0; }
  if (++sent > MAX_PER_MINUTE) return;
  try {
    const event = buildEvent(err, ctx);
    const body = [JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
    void fetch(`https://${dsn.host}/api/${dsn.project}/envelope/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=gotomenu/1` },
      body,
      signal: AbortSignal.timeout(2500),
    }).catch(() => undefined);
  } catch {
    /* reporting must never break the app */
  }
}
