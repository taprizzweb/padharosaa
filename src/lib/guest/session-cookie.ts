import 'server-only';
import type { NextResponse } from 'next/server';
import { serverEnv } from '@/env';
import { GUEST_COOKIE, GUEST_COOKIE_TTL_SECONDS, cookieAttributes, readCookie, signGuestCookie, verifyGuestCookie, type GuestSession } from '@/lib/security/cookie';

export function setGuestCookie(res: NextResponse, sessionId: string, slug: string): void {
  const exp = Math.floor(Date.now() / 1000) + GUEST_COOKIE_TTL_SECONDS;
  res.cookies.set(GUEST_COOKIE, signGuestCookie({ sessionId, slug, exp }, serverEnv().GUEST_COOKIE_SECRET), cookieAttributes(serverEnv().NEXT_PUBLIC_APP_ORIGIN.startsWith('https://')));
}

export function guestSessionFrom(headers: Headers): GuestSession | null {
  return verifyGuestCookie(readCookie(headers.get('cookie'), GUEST_COOKIE), serverEnv().GUEST_COOKIE_SECRET);
}
