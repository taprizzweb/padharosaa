import { describe, expect, it } from 'vitest';
import { ruleBp, splitBill } from '@/lib/padharosaa/posmath';

describe('GST rules by menu word', () => {
  const rules = [{ word: 'beer', rate_bp: 0 }, { word: 'bar', rate_bp: 1800 }, { word: 'cold drink', rate_bp: 1200 }];
  it('matches a word in the dish name or in its section, plurals too; the longest word wins', () => {
    expect(ruleBp(rules, 'Kingfisher Beer', 'Bar')).toBe(0);
    expect(ruleBp(rules, 'Craft Beers', null)).toBe(0);
    expect(ruleBp(rules, 'Cocktail', 'Bars')).toBe(1800);
    expect(ruleBp(rules, 'Thums Up', 'Cold Drinks')).toBe(1200);
  });
  it('does not match a word inside a longer word, and gives null when nothing fits', () => {
    expect(ruleBp(rules, 'Barbecue Platter', 'Mains')).toBeNull();
    expect(ruleBp(rules, 'Thali', 'Mains')).toBeNull();
    expect(ruleBp([], 'Beer', 'Bar')).toBeNull();
  });
});

describe('splitBill mirrors the database', () => {
  it('Thali 3 x 100 at 5% + beer 2 x 300 at 0%, discount 50, service 10%: 31,167 at 5% -> 1,558 tax, total 95,058', () => {
    const r = splitBill([{ amount: 30000, bp: 500 }, { amount: 60000, bp: 0 }], 5000, 1000);
    expect(r.service).toBe(8500);
    expect(r.groups).toEqual([{ tax_bp: 0, taxable_paise: 62333, tax_paise: 0 }, { tax_bp: 500, taxable_paise: 31167, tax_paise: 1558 }]);
    expect(r.grand).toBe(95058);
  });
  it('one rate on everything, no discount, no service: 2 x 320 + 5% = 672', () => {
    expect(splitBill([{ amount: 64000, bp: 500 }], 0, 0)).toMatchObject({ tax: 3200, grand: 67200 });
  });
  it('a discount that takes the whole bill gives nothing to pay', () => {
    expect(splitBill([{ amount: 1000, bp: 500 }], 1000, 0).grand).toBe(0);
  });
});
