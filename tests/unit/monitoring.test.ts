import { describe, expect, it } from 'vitest';
import { buildEvent, parseDsn, scrubText } from '@/lib/monitoring';

describe('error reporting scrubbing', () => {
  it('removes emails, tokens, ids, phone numbers and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcDEF123';
    const text = scrubText(`failed for owner@cafe.in token ${'a'.repeat(40)} user 3f2504e0-4f89-41d3-9a0c-0305e82c3301 call +91 98765 43210 ${jwt}`);
    expect(text).not.toMatch(/owner@cafe\.in|a{20}|3f2504e0|98765|eyJ/);
    expect(text).toContain('[email]');
  });
  it('builds an event with only type, scrubbed message, request id and route', () => {
    const e = buildEvent(new TypeError('bad thing for a@b.co'), { requestId: 'req-1', route: '/api/x' });
    expect(e.tags).toEqual({ request_id: 'req-1', route: '/api/x' });
    expect(JSON.stringify(e)).not.toContain('a@b.co');
    expect(Object.keys(e)).not.toContain('request');
    expect(Object.keys(e)).not.toContain('user');
  });
  it('accepts only https DSNs with a key and project', () => {
    expect(parseDsn('https://abc123@o1.ingest.sentry.io/42')).toEqual({ key: 'abc123', host: 'o1.ingest.sentry.io', project: '42' });
    expect(parseDsn('http://abc@host/1')).toBeNull();
    expect(parseDsn('not a url')).toBeNull();
  });
});
