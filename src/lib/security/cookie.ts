import { createHmac, timingSafeEqual } from 'node:crypto';

export const GUEST_COOKIE = 'gm_sid';
export const GUEST_COOKIE_TTL_SECONDS = 12 * 60 * 60;

export interface GuestSession {
  sessionId: string;
  slug: string;
  /** unix seconds */
  exp: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** value = base64url(json) "." base64url(HMAC-SHA256(secret, base64url(json))) */
export function signGuestCookie(s: GuestSession, secret: string): string {
  const body = Buffer.from(JSON.stringify({ s: s.sessionId, r: s.slug, e: s.exp })).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** Returns null for anything that is not a genuine, unexpired cookie we signed. Constant-time signature compare. */
export function verifyGuestCookie(value: string | undefined | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): GuestSession | null {
  if (!value || value.length > 600) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const j = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { s?: unknown; r?: unknown; e?: unknown };
    if (typeof j.s !== 'string' || !UUID.test(j.s) || typeof j.r !== 'string' || typeof j.e !== 'number') return null;
    if (!Number.isFinite(j.e) || j.e <= nowSeconds) return null;
    return { sessionId: j.s, slug: j.r, exp: j.e };
  } catch {
    return null;
  }
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function cookieAttributes(production: boolean): { httpOnly: true; secure: boolean; sameSite: 'lax'; path: '/'; maxAge: number } {
  return { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: GUEST_COOKIE_TTL_SECONDS };
}
