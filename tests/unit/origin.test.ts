import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '@/lib/security/origin';

const H = (o: Record<string, string>) => new Headers(o);
const APP = 'https://menu-azure-sigma.vercel.app';

describe('isAllowedOrigin', () => {
  it('accepts the configured address and the address the page is served from', () => {
    expect(isAllowedOrigin(H({ origin: APP }), APP)).toBe(true);
    expect(isAllowedOrigin(H({ origin: 'https://menu.taprizz.in', host: 'menu.taprizz.in' }), APP)).toBe(true);
    expect(isAllowedOrigin(H({ referer: 'https://menu.taprizz.in/login', host: 'menu.taprizz.in' }), APP)).toBe(true);
  });
  it('refuses other sites and missing proof', () => {
    expect(isAllowedOrigin(H({ origin: 'https://evil.example', host: 'menu.taprizz.in' }), APP)).toBe(false);
    expect(isAllowedOrigin(H({ origin: 'http://menu.taprizz.in', host: 'menu.taprizz.in' }), APP)).toBe(false);
    expect(isAllowedOrigin(H({ host: 'menu.taprizz.in' }), APP)).toBe(false);
  });
});
