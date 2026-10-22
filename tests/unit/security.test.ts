import { describe, expect, it } from 'vitest';
import { GUEST_COOKIE, cookieAttributes, readCookie, signGuestCookie, verifyGuestCookie } from '@/lib/security/cookie';
import { MAX_BODY_BYTES, isAllowedOrigin, isJson } from '@/lib/security/origin';
import { orderBody, requestBody } from '@/lib/schemas/guest';

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const SID = '8d3f1a52-6c0e-4b7a-9f21-3e5a7c9b1d44';
const NOW = 1_700_000_000;
const good = () => signGuestCookie({ sessionId: SID, slug: 'cafe-aroma', exp: NOW + 3600 }, SECRET);

describe('guest cookie', () => {
  it('round-trips a valid cookie', () => {
    expect(verifyGuestCookie(good(), SECRET, NOW)).toEqual({ sessionId: SID, slug: 'cafe-aroma', exp: NOW + 3600 });
  });
  it('rejects a wrong key', () => {
    expect(verifyGuestCookie(good(), 'a-different-secret-a-different-secret-1', NOW)).toBeNull();
  });
  it('rejects an expired cookie (and one expiring right now)', () => {
    const c = signGuestCookie({ sessionId: SID, slug: 'x-y', exp: NOW - 1 }, SECRET);
    expect(verifyGuestCookie(c, SECRET, NOW)).toBeNull();
    expect(verifyGuestCookie(signGuestCookie({ sessionId: SID, slug: 'x-y', exp: NOW }, SECRET), SECRET, NOW)).toBeNull();
  });
  it('rejects any tampering with payload or signature', () => {
    const [body, sig] = good().split('.') as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ s: '11111111-1111-4111-8111-111111111111', r: 'cafe-aroma', e: NOW + 3600 })).toString('base64url');
    expect(verifyGuestCookie(`${forgedBody}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyGuestCookie(`${body}.${sig.slice(0, -2)}AA`, SECRET, NOW)).toBeNull();
    expect(verifyGuestCookie(`${body}.`, SECRET, NOW)).toBeNull();
    expect(verifyGuestCookie(`${body}.${sig}.extra`, SECRET, NOW)).toBeNull();
    // extending the expiry while keeping the old signature must fail
    const longer = Buffer.from(JSON.stringify({ s: SID, r: 'cafe-aroma', e: NOW + 999999 })).toString('base64url');
    expect(verifyGuestCookie(`${longer}.${sig}`, SECRET, NOW)).toBeNull();
  });
  it('rejects garbage, empty and oversized values', () => {
    for (const v of [undefined, null, '', 'abc', '.', 'a.b', '....', 'x'.repeat(5000)]) expect(verifyGuestCookie(v as string, SECRET, NOW), String(v)).toBeNull();
  });
  it('rejects a correctly signed payload with a malformed session id', () => {
    const c = signGuestCookie({ sessionId: 'not-a-uuid', slug: 'a-b', exp: NOW + 10 }, SECRET);
    expect(verifyGuestCookie(c, SECRET, NOW)).toBeNull();
  });
  it('binds the cookie to a restaurant (slug is part of the signed data)', () => {
    expect(verifyGuestCookie(good(), SECRET, NOW)?.slug).toBe('cafe-aroma');
  });
  it('parses the Cookie header', () => {
    expect(readCookie(`a=1; ${GUEST_COOKIE}=xyz; b=2`, GUEST_COOKIE)).toBe('xyz');
    expect(readCookie('a=1', GUEST_COOKIE)).toBeUndefined();
    expect(readCookie(null, GUEST_COOKIE)).toBeUndefined();
    expect(readCookie(`x${GUEST_COOKIE}=nope`, GUEST_COOKIE)).toBeUndefined();
  });
  it('is HttpOnly, SameSite=Lax, Secure in production, 12 hours', () => {
    expect(cookieAttributes(true)).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 43200 });
    expect(cookieAttributes(false).secure).toBe(false);
  });
});

describe('origin / content-type checks', () => {
  const APP = 'https://gotomenu.taprizz.in';
  it('accepts only our exact origin', () => {
    expect(isAllowedOrigin(new Headers({ origin: APP }), APP)).toBe(true);
    for (const o of ['https://evil.example', 'http://gotomenu.taprizz.in', 'https://gotomenu.taprizz.in.evil.example', 'https://evil.gotomenu.taprizz.in', 'null', 'https://gotomenu.taprizz.in:8443']) {
      expect(isAllowedOrigin(new Headers({ origin: o }), APP), o).toBe(false);
    }
  });
  it('falls back to Referer when Origin is absent, and refuses when neither is present', () => {
    expect(isAllowedOrigin(new Headers({ referer: `${APP}/cafe-aroma?k=x` }), APP)).toBe(true);
    expect(isAllowedOrigin(new Headers({ referer: 'https://evil.example/x' }), APP)).toBe(false);
    expect(isAllowedOrigin(new Headers({ referer: 'not a url' }), APP)).toBe(false);
    expect(isAllowedOrigin(new Headers(), APP)).toBe(false);
  });
  it('an Origin header wins over a friendly Referer', () => {
    expect(isAllowedOrigin(new Headers({ origin: 'https://evil.example', referer: `${APP}/` }), APP)).toBe(false);
  });
  it('only accepts application/json', () => {
    expect(isJson(new Headers({ 'content-type': 'application/json' }))).toBe(true);
    expect(isJson(new Headers({ 'content-type': 'application/json; charset=utf-8' }))).toBe(true);
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonp', '']) expect(isJson(new Headers({ 'content-type': ct })), ct).toBe(false);
    expect(isJson(new Headers())).toBe(false);
  });
  it('has a small body limit', () => {
    expect(MAX_BODY_BYTES).toBeLessThanOrEqual(16 * 1024);
  });
});

describe('request schemas', () => {
  const base = { slug: 'cafe-aroma', token: 'a'.repeat(64), idempotency_key: 'abcd1234-abcd', items: [{ item_id: SID, qty: 2 }] };
  it('accepts a valid order and strips control characters from notes', () => {
    const r = orderBody.parse({ ...base, note: '  less\u0000 spicy\u0007 ', items: [{ item_id: SID, qty: 1, note: 'no\u001Fonion' }] });
    expect(r.note).toBe('less spicy');
    expect(r.items[0]!.note).toBe('noonion');
  });
  it('rejects unknown fields (so a client cannot smuggle a price or total)', () => {
    expect(orderBody.safeParse({ ...base, total_paise: 1 }).success).toBe(false);
    expect(orderBody.safeParse({ ...base, items: [{ item_id: SID, qty: 1, price_paise: 1 }] }).success).toBe(false);
  });
  it('enforces limits and formats', () => {
    const bad = [
      { ...base, items: [] },
      { ...base, items: Array.from({ length: 26 }, () => ({ item_id: SID, qty: 1 })) },
      { ...base, items: [{ item_id: SID, qty: 0 }] },
      { ...base, items: [{ item_id: SID, qty: 11 }] },
      { ...base, items: [{ item_id: SID, qty: 1.5 }] },
      { ...base, items: [{ item_id: 'x', qty: 1 }] },
      { ...base, token: 'short' },
      { ...base, token: 'G'.repeat(64) },
      { ...base, slug: 'A B' },
      { ...base, idempotency_key: 'short' },
      { ...base, idempotency_key: 'has space in it!!' },
      { ...base, note: 'x'.repeat(201) },
      { ...base, items: [{ item_id: SID, qty: 1, note: 'x'.repeat(101) }] },
      { ...base, items: 'nope' },
      {},
    ];
    for (const b of bad) expect(orderBody.safeParse(b).success, JSON.stringify(b).slice(0, 80)).toBe(false);
  });
  it('validates waiter and bill requests', () => {
    const t = { slug: 'cafe-aroma', token: 'b'.repeat(64) };
    expect(requestBody.safeParse({ ...t, type: 'waiter', reason: 'water' }).success).toBe(true);
    expect(requestBody.safeParse({ ...t, type: 'bill', pay_mode: 'upi' }).success).toBe(true);
    for (const b of [
      { ...t, type: 'waiter', reason: 'dance' },
      { ...t, type: 'waiter' },
      { ...t, type: 'bill', pay_mode: 'bitcoin' },
      { ...t, type: 'bill', reason: 'water' },
      { ...t, type: 'refund' },
      { ...t, type: 'waiter', reason: 'water', extra: 1 },
    ]) expect(requestBody.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });
});
