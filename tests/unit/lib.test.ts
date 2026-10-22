import { describe, expect, it } from 'vitest';
import { formatPaise, lineTotal, parseRupeesToPaise, assertPaise } from '@/lib/money';
import { en, t, errorMessageKey } from '@/lib/i18n';
import { ACCENTS, contrastRatio } from '@/lib/accent';
import { COUNTER_INSTRUCTION, counterInstruction } from '@/lib/pay';
import { SQL_ERRORS, fromDbError } from '@/lib/errors';
import { clientIp, hashIp } from '@/lib/security/ip';
import { log } from '@/lib/log';
import { readFileSync } from 'node:fs';

describe('money', () => {
  it('formats paise as rupees with Indian digit grouping', () => {
    expect(formatPaise(0)).toBe('₹0');
    expect(formatPaise(25000)).toBe('₹250');
    expect(formatPaise(25050)).toBe('₹250.50');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(99999)).toBe('₹999.99');
    expect(formatPaise(100000)).toBe('₹1,000');
    expect(formatPaise(12345600)).toBe('₹1,23,456');
    expect(formatPaise(1500000)).toBe('₹15,000');
    expect(formatPaise(-1050)).toBe('-₹10.50');
  });
  it('rejects non-integers: money is never floating point', () => {
    expect(() => formatPaise(10.5)).toThrow(RangeError);
    expect(() => assertPaise(NaN)).toThrow();
    expect(() => lineTotal(1.5, 2)).toThrow();
  });
  it('computes line totals exactly', () => {
    expect(lineTotal(25000, 3)).toBe(75000);
    expect(lineTotal(1999, 10)).toBe(19990);
  });
  it('parses typed rupee amounts', () => {
    expect(parseRupeesToPaise('250')).toBe(25000);
    expect(parseRupeesToPaise('₹1,200.50')).toBe(120050);
    expect(parseRupeesToPaise('250.5')).toBe(25050);
    for (const bad of ['', 'abc', '-5', '1.234', '1e3', '12345678', '0x10']) expect(parseRupeesToPaise(bad), bad).toBeNull();
  });
});

describe('user-facing text', () => {
  it('no message is empty', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(en[k].trim().length, k).toBeGreaterThan(0);
  });
  it('interpolates variables and leaves unknown placeholders visible', () => {
    expect(t('app.table', { label: '5' })).toBe('Table 5');
    expect(t('app.table')).toBe('Table {label}');
  });
  it('every API error key the server can return has a message', () => {
    const keys = [...Object.values(SQL_ERRORS).map((e) => e.key), 'origin_not_allowed', 'unsupported_media_type', 'payload_too_large', 'unauthorized', 'password_change_required', 'invalid_credentials', 'method_not_allowed', 'server_error'];
    for (const k of keys) {
      const mk = errorMessageKey(k);
      expect(mk, k).toBe(`error.${k}`);
      expect(en[mk]).toBeTruthy();
    }
    expect(errorMessageKey('something_new')).toBe('error.server_error');
    expect(errorMessageKey(undefined)).toBe('error.server_error');
    expect(errorMessageKey('constructor')).toBe('error.server_error');
  });
  it('button copy is verb-first (no OK / Submit / Proceed)', () => {
    for (const v of Object.values(en)) expect(v).not.toMatch(/^(OK|Submit|Proceed|Yes|No)$/);
  });
});

describe('accent palette', () => {
  it('every accent gives white text WCAG AA contrast (>= 4.5:1)', () => {
    for (const [name, hex] of Object.entries(ACCENTS)) expect(contrastRatio(hex, '#ffffff'), name).toBeGreaterThanOrEqual(4.5);
  });
  it('CSS variables in globals.css match the palette', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    for (const name of Object.keys(ACCENTS)) expect(css.toLowerCase(), name).toContain(`[data-accent='${name}']`);
    for (const hex of Object.values(ACCENTS)) {
      const n = parseInt(hex.slice(1), 16);
      expect(css).toContain(`${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`);
    }
  });
});

describe('counter instructions (what staff bring to the table)', () => {
  it('maps each payment mode', () => {
    expect(counterInstruction('upi')).toBe('Bring bill + payment QR');
    expect(counterInstruction('card')).toBe('Bring bill + card machine');
    expect(counterInstruction('cash')).toBe('Bring bill (cash payment)');
    expect(Object.keys(COUNTER_INSTRUCTION).sort()).toEqual(['card', 'cash', 'upi']);
  });
  it('falls back safely for unknown values', () => {
    expect(counterInstruction(null)).toBe('Bring bill');
    expect(counterInstruction('bitcoin')).toBe('Bring bill');
    expect(counterInstruction('constructor')).toBe('Bring bill');
  });
});

describe('database error mapping', () => {
  it('maps every known code to a status and key', () => {
    for (const [code, v] of Object.entries(SQL_ERRORS)) {
      const e = fromDbError({ code, message: 'internal text must never be shown' });
      expect(e?.status).toBe(v.status);
      expect(e?.key).toBe(v.key);
      expect(e?.message).not.toContain('internal');
    }
  });
  it('returns null for unknown / missing codes so they become a generic 500', () => {
    expect(fromDbError({ code: '23505' })).toBeNull();
    expect(fromDbError({ code: 'XX000', message: 'boom' })).toBeNull();
    expect(fromDbError({})).toBeNull();
    expect(fromDbError(null)).toBeNull();
    expect(fromDbError({ code: '__proto__' })).toBeNull();
  });
});

describe('ip hashing', () => {
  it('takes the first forwarded address and hashes it with a salt', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    expect(clientIp(h)).toBe('203.0.113.9');
    const a = hashIp('203.0.113.9', 'salt-one-salt-one-1');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('203');
    expect(hashIp('203.0.113.9', 'salt-one-salt-one-1')).toBe(a);
    expect(hashIp('203.0.113.9', 'another-salt-another')).not.toBe(a);
    expect(hashIp('203.0.113.10', 'salt-one-salt-one-1')).not.toBe(a);
  });
  it('falls back safely when no proxy header exists', () => {
    expect(clientIp(new Headers())).toBe('unknown');
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
  });
});

describe('logging', () => {
  it('redacts sensitive-looking fields', () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (s: string) => lines.push(s);
    try {
      log('error', 'x', { requestId: 'r1', token: 'abc123secret', cookie: 'c', nested: { password: 'p', ok: 1 }, ip: '1.2.3.4' });
    } finally {
      console.error = orig;
    }
    const out = lines.join('');
    expect(out).toContain('r1');
    for (const s of ['abc123secret', '1.2.3.4', '"p"']) expect(out).not.toContain(s);
    expect(out).toContain('[redacted]');
  });
});
