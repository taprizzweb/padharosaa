import 'server-only';
import type { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { serverEnv } from '@/env';
import { ApiError } from '@/lib/errors';
import { guestRoute, type Ctx } from '@/lib/api/route';
import { rpc } from '@/lib/guest/rpc';
import { readCookie } from '@/lib/security/cookie';
import { requireWellFormedToken, tokenHash, toBytea } from './crypto';

/**
 * Guest cookie. Its value is the random 256-bit session token; the database keeps only the SHA-256, so a database leak cannot be
 * replayed as a login. HttpOnly + Secure + SameSite=Lax, never in a URL or log. Path is "/" (the API lives under /api, outside the
 * hotel page path); the token itself ties the cookie to exactly one hotel and one room. The __Host- prefix is used on https.
 */
const secure = () => serverEnv().NEXT_PUBLIC_APP_ORIGIN.startsWith('https://');
export const padCookieName = () => (secure() ? '__Host-padh_sid' : 'padh_sid');
export const PAD_COOKIE_MAX_AGE = 14 * 24 * 60 * 60;

export function setPadCookie(res: NextResponse, token: string): void {
  res.cookies.set(padCookieName(), token, { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: PAD_COOKIE_MAX_AGE });
}
export function clearPadCookie(res: NextResponse): void {
  res.cookies.set(padCookieName(), '', { httpOnly: true, secure: secure(), sameSite: 'lax', path: '/', maxAge: 0 });
}
export const readPadToken = (headers: Headers): string | undefined => readCookie(headers.get('cookie'), padCookieName());

export interface PadSession {
  session_id: string;
  restaurant_id: string;
  room: string;
  name: string;
  language: string;
  diet: string | null;
  occasion: string | null;
  hotel_name: string;
  slug: string;
  theme: string;
  verification_level: string;
  timezone: string;
  is_demo?: boolean;
}
export interface PadCtx extends Ctx {
  me: PadSession;
}

/** Guest route that requires a live Padharosaa session (cookie -> hash -> database). Closed or expired sessions get 401 session_closed. */
export function padGuestRoute<B = undefined>(
  req: Request,
  opts: { method: 'GET' | 'POST'; schema?: ZodType<B>; maxBytes?: number },
  run: (ctx: PadCtx, body: B) => Promise<Response>,
): Promise<Response> {
  return guestRoute(req, opts, async (ctx, body) => {
    const token = requireWellFormedToken(readPadToken(req.headers));
    const me = await rpc<{ ok: boolean } & PadSession>('padh_guest_resolve_session', { p_token_hash: toBytea(tokenHash(token)) });
    if (!me.ok) throw new ApiError(401, 'session_closed');
    if (me.is_demo) await rpc('padh_demo_tick', { p_session: me.session_id }).catch(() => undefined); // a public demo answers itself
    return run({ ...ctx, me }, body);
  });
}
