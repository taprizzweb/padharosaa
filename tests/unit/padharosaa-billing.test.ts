import { describe, expect, it } from 'vitest';
import { dateLabel, dayFromToday, nightsBetween, parsePercent, payModeLabel, pct, rupees2 } from '@/lib/padharosaa/billing';

describe('billing display helpers', () => {
  it('amounts always show two decimals with Indian grouping', () => {
    expect(rupees2(766600)).toBe('₹7,666.00');
    expect(rupees2(5)).toBe('₹0.05');
    expect(rupees2(12345650)).toBe('₹1,23,456.50');
    expect(rupees2(-4800)).toBe('-₹48.00');
    expect(rupees2(0)).toBe('₹0.00');
  });
  it('tax rates in percent and back', () => {
    expect(pct(500)).toBe('5%');
    expect(pct(250)).toBe('2.5%');
    expect(pct(1800)).toBe('18%');
    expect(pct(0)).toBe('0%');
    expect(parsePercent('5')).toBe(500);
    expect(parsePercent(' 2.5 % ')).toBe(250);
    expect(parsePercent('18%')).toBe(1800);
    expect(parsePercent('100')).toBe(10000);
    expect(parsePercent('101')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
    expect(parsePercent('-5')).toBeNull();
    expect(parsePercent('')).toBeNull();
  });
  it('days are counted in the hotel time zone, not the phone\'s', () => {
    // 20:00 UTC on 31 Oct is already 1 Nov, 01:30 in India
    const now = new Date('2026-10-31T20:00:00Z');
    expect(dayFromToday(0, now)).toBe('2026-11-01');
    expect(dayFromToday(1, now)).toBe('2026-11-02');
    expect(dayFromToday(30, now)).toBe('2026-12-01');
    expect(dayFromToday(0, now, 'UTC')).toBe('2026-10-31');
    expect(nightsBetween('2026-11-01', '2026-11-03')).toBe(2);
    expect(nightsBetween('2026-11-01', '2026-11-01')).toBe(1);
    expect(nightsBetween('2026-02-27', '2026-03-02')).toBe(3);
  });
  it('labels', () => {
    expect(dateLabel('2026-11-01')).toBe('1 Nov 2026');
    expect(payModeLabel('upi')).toBe('UPI');
    expect(payModeLabel('company')).toBe('Bill to company');
    expect(payModeLabel('x')).toBe('x');
  });
});
