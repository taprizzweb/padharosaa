import { describe, expect, it } from 'vitest';
import { buildCsp, newNonce, securityHeaders } from '@/lib/security/csp';

const base = { nonce: 'abc123==', dev: false, supabaseUrl: 'https://proj.supabase.co' };
const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('CSP builder (production)', () => {
  const csp = buildCsp(base);
  it('uses a nonce with strict-dynamic and no unsafe-eval / unsafe-inline for scripts', () => {
    const s = directive(csp, 'script-src');
    expect(s).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(s).not.toContain('unsafe');
  });
  it('locks down objects, base, framing and forms', () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('limits connect-src to self and our Supabase project (https + wss)', () => {
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co");
  });
  it('limits img-src to self, data:, blob: and Supabase storage', () => {
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: blob: https://proj.supabase.co");
  });
  it('styles use the nonce in production (no unsafe-inline for style elements)', () => {
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'nonce-abc123=='");
  });
  it('has no wildcard sources', () => {
    expect(csp).not.toMatch(/\s\*[\s;]|\*$/);
  });
  it('production over https never allows plain http/ws connections', () => {
    expect(buildCsp(base)).not.toMatch(/http:\/\/|ws:\/\//);
    expect(buildCsp({ ...base, secure: false })).toContain('http://proj.supabase.co');
  });
  it('does not force https upgrades when the site itself is served over plain http (local testing only)', () => {
    expect(buildCsp({ ...base, secure: false })).not.toContain('upgrade-insecure-requests');
  });
  it('adds a Sentry origin only when configured', () => {
    expect(buildCsp({ ...base, sentryOrigin: 'https://o1.ingest.sentry.io' })).toContain('https://o1.ingest.sentry.io');
    expect(csp).not.toContain('sentry');
  });
});

describe('CSP builder (development)', () => {
  const csp = buildCsp({ ...base, dev: true });
  it('relaxes eval and inline styles only in development', () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'style-src')).toContain("'unsafe-inline'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
  it('production never contains unsafe-eval', () => {
    expect(buildCsp(base)).not.toContain('unsafe-eval');
  });
});

describe('security headers', () => {
  const h = securityHeaders(base);
  it('contains every required header with the right value', () => {
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['X-Frame-Options']).toBe('DENY');
    for (const f of ['camera', 'microphone', 'payment']) expect(h['Permissions-Policy']).toContain(`${f}=()`);
    expect(h['Permissions-Policy']).toContain('geolocation=(self)'); // only our own pages may ask, for the optional near-the-cafe ordering rule
  });
});

describe('nonce', () => {
  it('is unique per call and at least 128 bits', () => {
    const set = new Set(Array.from({ length: 500 }, () => newNonce()));
    expect(set.size).toBe(500);
    expect(atob([...set][0]!).length).toBeGreaterThanOrEqual(16);
  });
});
