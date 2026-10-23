import { describe, expect, it } from 'vitest';

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3100';
const pad = { 'x-forwarded-host': 'padharosaa.taprizz.in' };

describe('one app, two front doors', () => {
  it('padharosaa.* shows the Padharosaa staff sign-in on / and /login', async () => {
    for (const path of ['/', '/login', '/login?next=%2Fpadharosaa%2Fdesk']) {
      const res = await fetch(BASE + path, { headers: pad });
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html, path).toContain('Hotel staff sign in');
    }
  });
  it('padharosaa.* sends the old menu live screen to the hotel desk (which then asks for sign-in)', async () => {
    const res = await fetch(BASE + '/staff', { headers: pad, redirect: 'manual' });
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/padharosaa/desk');
    const desk = await fetch(BASE + '/padharosaa/desk', { headers: pad, redirect: 'manual' });
    expect(new URL(desk.headers.get('location')!).pathname).toBe('/login');
  });
  it('the menu host is untouched: /login is the menu staff sign-in', async () => {
    const html = await (await fetch(BASE + '/login', { headers: { 'x-forwarded-host': 'menu.taprizz.in' } })).text();
    expect(html).toContain('Staff sign in');
    expect(html).not.toContain('Hotel staff sign in');
  });
  it('security headers still ride on the rewritten page', async () => {
    const res = await fetch(BASE + '/', { headers: pad });
    expect(res.headers.get('content-security-policy')).toMatch(/'nonce-/);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
