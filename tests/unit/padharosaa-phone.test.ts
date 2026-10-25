import { describe, expect, it } from 'vitest';
import { dialNumber, prettyPhone } from '@/lib/padharosaa/phone';

describe('hotel phone numbers', () => {
  it('always dial in international form, so the call goes through', () => {
    expect(dialNumber('919828114008')).toBe('+919828114008');
    expect(dialNumber('9828114008')).toBe('+919828114008');
    expect(dialNumber('09828114008')).toBe('+919828114008');
    expect(dialNumber('+91 98281 14008')).toBe('+919828114008');
    expect(dialNumber('+44 20 7946 0958')).toBe('+442079460958');
    expect(dialNumber('442079460958')).toBe('+442079460958');
    expect(dialNumber('0141 2370101')).toBe('+911412370101'); // a Jaipur landline with its 0 prefix
    expect(dialNumber('12345')).toBe('12345'); // a short internal number is left as it is
  });
  it('are shown with the plus sign and spaced', () => {
    expect(prettyPhone('919828114008')).toBe('+91 98281 14008');
    expect(prettyPhone('+919828114008')).toBe('+91 98281 14008');
    expect(prettyPhone('442079460958')).toBe('+442079460958');
    expect(prettyPhone(null)).toBe('');
  });
});
