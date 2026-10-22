import { describe, expect, it } from 'vitest';

const BASE = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3100';

describe('security headers on a real response', () => {
  const pages = ['/', '/api/health'];
  for (const path of pages) {
    describe(path, () => {
      it('sends every required security header', async () => {
        const res = await fetch(BASE + path);
        const h = res.headers;
        expect(h.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains; preload');
        expect(h.get('x-content-type-options')).toBe('nosniff');
        expect(h.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
        expect(h.get('cross-origin-opener-policy')).toBe('same-origin');
        expect(h.get('x-frame-options')).toBe('DENY');
        const pp = h.get('permissions-policy') ?? '';
        for (const f of ['camera', 'microphone', 'payment']) expect(pp).toContain(`${f}=()`);
        expect(pp).toContain('geolocation=(self)'); // only our own pages may ask (the optional near-the-cafe ordering rule)
        expect(h.get('x-powered-by')).toBeNull();
        expect(h.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      });
      it('sends a strict nonce-based CSP', async () => {
        const csp = (await fetch(BASE + path)).headers.get('content-security-policy') ?? '';
        expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
        expect(csp).not.toContain('unsafe-eval');
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("base-uri 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("form-action 'self'");
        expect(csp).toMatch(/connect-src 'self' https:\/\/[^ ]+ wss:\/\/[^ ;]+(;|$)/);
        expect(csp).toMatch(/img-src 'self' data: blob: https:\/\/[^ ;]+/);
      });
    });
  }

  it('uses a different nonce on every request, and the page scripts carry it', async () => {
    const a = await fetch(BASE + '/');
    const b = await fetch(BASE + '/');
    const nonce = (r: Response) => /'nonce-([^']+)'/.exec(r.headers.get('content-security-policy') ?? '')?.[1];
    expect(nonce(a)).toBeTruthy();
    expect(nonce(a)).not.toBe(nonce(b));
    const html = await a.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s, s).toContain(`nonce="${nonce(a)}"`);
  });

  it('error pages also carry the headers', async () => {
    const res = await fetch(BASE + '/definitely-not-a-page-xyz');
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
    expect(res.headers.get('content-security-policy')).toContain("object-src 'none'");
  });

  it('error pages also carry the headers (kept)', async () => {
    const res = await fetch(BASE + '/definitely-not-a-page-xyz-2');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('signed-out visitors cannot reach protected areas', () => {
  // The test server points at a Supabase address that does not exist, which also proves the guard FAILS CLOSED:
  // if the login service cannot be reached, nobody is let in.
  for (const area of ['/staff', '/staff/anything', '/dash', '/admin']) {
    it(`${area} redirects to the sign-in page`, async () => {
      const res = await fetch(BASE + area, { redirect: 'manual' });
      expect(res.status).toBe(307);
      const loc = res.headers.get('location') ?? '';
      expect(new URL(loc, BASE).pathname).toBe('/login');
      expect(res.headers.get('content-security-policy')).toContain("object-src 'none'");
    });
  }
  it('staff API answers 401 without a session', async () => {
    expect((await fetch(BASE + '/api/staff/board')).status).toBe(401);
  });
  it('the sign-in page itself is public', async () => {
    expect((await fetch(BASE + '/login')).status).toBe(200);
  });
});
