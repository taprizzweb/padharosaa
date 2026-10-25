import { describe, expect, it } from 'vitest';
import { parseVoucherLines } from '@/lib/padharosaa/wifi';

describe('Wi-Fi logins pasted by the owner', () => {
  it('reads one login per line, whatever separates the two parts', () => {
    const r = parseVoucherLines('70012 JHWS\n70013,KPLM\r\n70014;ABCD\n70015\tQWER\n\n   70016   ZXCV  ');
    expect(r.ok).toEqual([{ username: '70012', password: 'JHWS' }, { username: '70013', password: 'KPLM' }, { username: '70014', password: 'ABCD' }, { username: '70015', password: 'QWER' }, { username: '70016', password: 'ZXCV' }]);
    expect(r.bad).toEqual([]);
  });
  it('skips a header row and repeated usernames, and reports lines that are not a login', () => {
    const r = parseVoucherLines('Username,Password\n70012,JHWS\n70012,OTHER\njust-one-word\n1 2 3\n' + 'x'.repeat(70) + ' pw');
    expect(r.ok).toEqual([{ username: '70012', password: 'JHWS' }]);
    expect(r.bad).toHaveLength(3);
  });
});
