import { describe, expect, it } from 'vitest';
import { decryptText, encryptText, mobileHash, newSessionToken, TOKEN_RE, tokenHash, toBytea } from '@/lib/padharoso/crypto';
import { cleanText, loginBody, createRequestBody, dismissBody } from '@/lib/padharoso/schemas';

describe('padharoso crypto', () => {
  it('encrypts and decrypts, never leaks the plaintext, and a fresh IV makes every ciphertext different', () => {
    const a = encryptText('+919876543210');
    const b = encryptText('+919876543210');
    expect(a.equals(b)).toBe(false);
    expect(a.toString('latin1')).not.toContain('9876543210');
    expect(decryptText(a)).toBe('+919876543210');
  });
  it('detects tampering and unknown versions', () => {
    const a = encryptText('secret');
    const bad = Buffer.from(a);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    expect(() => decryptText(bad)).toThrow();
    const v2 = Buffer.from(a);
    v2[0] = 2;
    expect(() => decryptText(v2)).toThrow();
    expect(() => decryptText(Buffer.from('short'))).toThrow();
  });
  it('mobile hash is stable, keyed, and separates country codes', () => {
    expect(mobileHash('+91', '9876543210').equals(mobileHash('+91', '9876543210'))).toBe(true);
    expect(mobileHash('+91', '9876543210').equals(mobileHash('+44', '9876543210'))).toBe(false);
    expect(mobileHash('+91', '9876543210')).toHaveLength(32);
  });
  it('session tokens are 256-bit, url-safe, unique, and hashed with sha256', () => {
    const t = newSessionToken();
    expect(t).toMatch(TOKEN_RE);
    expect(newSessionToken()).not.toBe(t);
    expect(tokenHash(t)).toHaveLength(32);
    expect(toBytea(Buffer.from([1, 255]))).toBe('\\x01ff');
  });
});

describe('padharoso input schemas', () => {
  const ok = { k: 'a'.repeat(64), name: 'Anita', cc: '+91', mobile: '98765 43210', room: '204' };
  it('accepts a normal login and applies defaults', () => {
    expect(loginBody.parse(ok)).toMatchObject({ language: 'en', consent: false, name: 'Anita' });
  });
  it('enforces the mobile rules: +91 is 10 digits starting 6-9, others 6-14 digits', () => {
    for (const mobile of ['1234567890', '987654321', '98765432101', 'abcdefghij']) expect(loginBody.safeParse({ ...ok, mobile }).success, mobile).toBe(false);
    expect(loginBody.safeParse({ ...ok, cc: '+44', mobile: '7911123456' }).success).toBe(true);
    expect(loginBody.safeParse({ ...ok, cc: '+44', mobile: '12345' }).success).toBe(false);
    expect(loginBody.safeParse({ ...ok, cc: '91' }).success).toBe(false);
  });
  it('rejects unknown fields, bad languages, short names, bad QR keys, consent without a text version', () => {
    for (const bad of [{ extra: 1 }, { language: 'xx' }, { name: 'A' }, { k: 'xyz' }, { consent: true }, { stay_code: '12' }, { room: '' }])
      expect(loginBody.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });
  it('cleans names: bidi overrides, control characters, repeated spaces', () => {
    expect(cleanText('  Pi‮erre\u0007   Du⁦pont ')).toBe('Pierre Dupont');
    expect(loginBody.parse({ ...ok, name: 'Pi‮erre   Dupont' }).name).toBe('Pierre Dupont');
  });
  it('guests cannot create system request types; staff dismissal needs 3-140 characters', () => {
    for (const type of ['food', 'chat_message', 'feedback_alert', 'vista']) expect(createRequestBody.safeParse({ type, label: 'x' }).success, type).toBe(false);
    expect(createRequestBody.safeParse({ type: 'cab', label: 'Cab' }).success).toBe(true);
    expect(dismissBody.safeParse({ version: 1, reason: 'no' }).success).toBe(false);
    expect(dismissBody.safeParse({ version: 1, reason: 'x'.repeat(141) }).success).toBe(false);
    expect(dismissBody.safeParse({ version: 1, reason: 'slot_full' }).success).toBe(true);
  });
});
