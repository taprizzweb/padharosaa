import { describe, expect, it } from 'vitest';
import { EnvError, parseServerEnv } from '@/env';

const good = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcd1234.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
  NEXT_PUBLIC_APP_ORIGIN: 'https://gotomenu.taprizz.in',
  SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40),
  GUEST_COOKIE_SECRET: 'c'.repeat(48),
  IP_HASH_SALT: 'i'.repeat(24),
};

describe('server env validation', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = parseServerEnv(good);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SENTRY_DSN).toBeUndefined();
  });
  it('treats an empty SENTRY_DSN as not configured', () => {
    expect(parseServerEnv({ ...good, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
  });
  it('fails fast and names every missing variable', () => {
    try {
      parseServerEnv({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as Error).message;
      for (const k of Object.keys(good)) expect(msg).toContain(k);
      expect(msg).toContain('.env.example');
    }
  });
  it('rejects weak secrets', () => {
    expect(() => parseServerEnv({ ...good, GUEST_COOKIE_SECRET: 'short' })).toThrow(/GUEST_COOKIE_SECRET/);
    expect(() => parseServerEnv({ ...good, IP_HASH_SALT: 'x' })).toThrow(/IP_HASH_SALT/);
  });
  it('rejects a malformed URL', () => {
    expect(() => parseServerEnv({ ...good, NEXT_PUBLIC_SUPABASE_URL: 'not a url' })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
  it('never echoes secret values in the error message', () => {
    try {
      parseServerEnv({ ...good, GUEST_COOKIE_SECRET: 'tooshort-secret-value' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('tooshort-secret-value');
    }
  });
});

describe('production URL rules', () => {
  it('accepts https and loopback http, rejects other plain http (checked in a production-mode process)', async () => {
    const { spawnSync } = await import('node:child_process');
    const probe = `
      import { parseServerEnv } from './src/env';
      const good = ${JSON.stringify(good)};
      const ok = (u) => { try { parseServerEnv({ ...good, NEXT_PUBLIC_SUPABASE_URL: u }); return true; } catch { return false; } };
      console.log(JSON.stringify({
        https: ok('https://abc.supabase.co'),
        loop1: ok('http://127.0.0.1:54321'),
        loop2: ok('http://localhost:54321'),
        plain: ok('http://abc.supabase.co'),
        sneaky: ok('http://127.0.0.1.evil.com'),
        sneaky2: ok('http://localhost.evil.com'),
      }));`;
    const r = spawnSync('node_modules/.bin/tsx', ['-e', probe], { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' });
    expect(JSON.parse(r.stdout.trim())).toEqual({ https: true, loop1: true, loop2: true, plain: false, sneaky: false, sneaky2: false });
  });
});
