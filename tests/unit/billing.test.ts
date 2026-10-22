import { describe, expect, it } from 'vitest';
import { addMonths, describeExpiry, endOfDayIst, expiryOf, istDate, paiseToRupees, rupeesToPaise } from '@/lib/billing';

describe('rupee inputs', () => {
  it('turns rupees into paise and refuses nonsense', () => {
    expect(rupeesToPaise('2,499')).toBe(249900);
    expect(rupeesToPaise('₹ 2499.5')).toBe(249950);
    expect(rupeesToPaise('')).toBe(0);
    for (const bad of ['-5', 'abc', '1.234', '12345678901', '1e5']) expect(rupeesToPaise(bad), bad).toBeNull();
    expect(paiseToRupees(249900)).toBe('2499');
    expect(paiseToRupees(249950)).toBe('2499.50');
  });
});

describe('dates', () => {
  it('adds months on the same calendar day, clamping to the end of short months', () => {
    expect(addMonths('2026-11-01', 1)).toBe('2026-12-01');
    expect(addMonths('2026-11-15', 12)).toBe('2027-11-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-31', 3)).toBe('2027-03-31');
  });
  it('an end date lasts to the last second of that day in India', () => {
    expect(endOfDayIst('2027-03-31')).toBe('2027-03-31T18:29:59.000Z');
    expect(istDate('2027-03-31T18:29:59.000Z')).toBe('2027-03-31');
    expect(endOfDayIst('')).toBeNull();
  });
});

describe('where a restaurant stands against its end date', () => {
  const now = new Date('2026-11-10T06:00:00Z');
  const ends = (days: number) => new Date(now.getTime() + days * 86400_000).toISOString();
  it('has no end date, is fine, ends soon, or has ended', () => {
    expect(expiryOf(null, false, 0, now)).toEqual({ kind: 'none' });
    expect(expiryOf(ends(40), false, 0, now)).toMatchObject({ kind: 'active', daysLeft: 40 });
    expect(expiryOf(ends(10), false, 0, now)).toMatchObject({ kind: 'soon', daysLeft: 10 });
    expect(describeExpiry(expiryOf(ends(0.2), false, 0, now))).toBe('Ends in 1 day');
    expect(expiryOf(ends(-3), false, 0, now)).toMatchObject({ kind: 'ended', daysOver: 3, paused: false });
  });
  it('knows about the grace days and when the menu has paused itself', () => {
    expect(expiryOf(ends(-3), true, 7, now)).toMatchObject({ kind: 'grace', daysOver: 3, graceLeft: 4 });
    expect(expiryOf(ends(-9), true, 7, now)).toMatchObject({ kind: 'ended', paused: true });
    expect(describeExpiry(expiryOf(ends(-9), true, 7, now))).toContain('menu paused');
    expect(expiryOf(ends(-1), true, 0, now)).toMatchObject({ kind: 'ended', paused: true });
  });
});
