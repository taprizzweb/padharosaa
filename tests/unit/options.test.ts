import { describe, expect, it } from 'vitest';
import { fromPrice, isCustomisable, lineKey, lineLabel, selectionProblem, unitPrice } from '@/lib/guest/options';
import type { MenuItem } from '@/lib/guest/types';

const base: MenuItem = { id: 'i1', name_en: 'Shake', description_en: null, price_paise: 12000, diet: 'veg', spice: 0, image_path: null, is_available: true, is_bestseller: false, is_chef_pick: false };
const shake: MenuItem = {
  ...base,
  variants: [
    { id: 's', name: 'Small', price_paise: 12000, is_available: true },
    { id: 'l', name: 'Large', price_paise: 20000, is_available: true },
    { id: 'x', name: 'XL', price_paise: 25000, is_available: false },
  ],
  option_groups: [
    { id: 'g1', name: 'Topping', required: true, max_select: 1, options: [{ id: 'o1', name: 'Oreo', price_delta_paise: 0 }, { id: 'o2', name: 'Choco', price_delta_paise: 1500 }] },
    { id: 'g2', name: 'Extras', required: false, max_select: 2, options: [{ id: 'o3', name: 'Cream', price_delta_paise: 1000 }, { id: 'o4', name: 'Nuts', price_delta_paise: 2000 }, { id: 'o5', name: 'Syrup', price_delta_paise: 500 }] },
  ],
};

describe('sizes and options helpers', () => {
  it('knows which dishes need a choice', () => {
    expect(isCustomisable(base)).toBe(false);
    expect(isCustomisable({ ...base, variants: [], option_groups: [] })).toBe(false);
    expect(isCustomisable(shake)).toBe(true);
    expect(isCustomisable({ ...base, option_groups: shake.option_groups })).toBe(true);
  });
  it('gives one cart line per dish + size + options, whatever the order of the options', () => {
    expect(lineKey('i1')).toBe('i1');
    expect(lineKey('i1', null, [])).toBe('i1');
    expect(lineKey('i1', 'l', ['o2', 'o1'])).toBe(lineKey('i1', 'l', ['o1', 'o2']));
    expect(lineKey('i1', 'l', ['o1'])).not.toBe(lineKey('i1', 's', ['o1']));
    expect(lineKey('i1', undefined, ['o1'])).not.toBe(lineKey('i1'));
  });
  it('prices a choice: size price plus the extras; null when the choice is not allowed', () => {
    expect(unitPrice(shake, 's', ['o1'])).toBe(12000);
    expect(unitPrice(shake, 'l', ['o2', 'o3', 'o4'])).toBe(20000 + 1500 + 1000 + 2000);
    expect(unitPrice(base)).toBe(12000);
    expect(unitPrice(shake, 'l')).toBeNull(); // required topping missing
    expect(unitPrice(shake, undefined, ['o1'])).toBeNull(); // size missing
    expect(unitPrice(shake, 'x', ['o1'])).toBeNull(); // sold-out size
    expect(unitPrice(shake, 'zz', ['o1'])).toBeNull();
    expect(unitPrice(base, 's')).toBeNull(); // a size on a dish that has none
  });
  it('says what is wrong', () => {
    expect(selectionProblem(shake, undefined, ['o1'])).toEqual({ problem: 'size' });
    expect(selectionProblem(shake, 'x', ['o1'])).toEqual({ problem: 'soldout' });
    expect(selectionProblem(shake, 'l', [])).toEqual({ problem: 'required', group: 'Topping' });
    expect(selectionProblem(shake, 'l', ['o1', 'o2'])).toEqual({ problem: 'max', group: 'Topping' });
    expect(selectionProblem(shake, 'l', ['o1', 'o3', 'o4', 'o5'])).toEqual({ problem: 'max', group: 'Extras' });
    expect(selectionProblem(shake, 'l', ['o1', 'o1'])).toEqual({ problem: 'unknown' });
    expect(selectionProblem(shake, 'l', ['nope'])).toEqual({ problem: 'unknown' });
    expect(selectionProblem(shake, 'l', ['o1', 'o3'])).toBeNull();
  });
  it('labels a line for the cart', () => {
    expect(lineLabel(shake, 'l', ['o2', 'o3'])).toBe('Large · Choco, Cream');
    expect(lineLabel(shake, 's', ['o1'])).toBe('Small · Oreo');
    expect(lineLabel(base)).toBe('');
  });
  it('shows "from" the cheapest size that can be ordered', () => {
    expect(fromPrice(shake)).toBe(12000);
    expect(fromPrice({ ...shake, variants: [{ id: 'a', name: 'A', price_paise: 100, is_available: false }, { id: 'b', name: 'B', price_paise: 300, is_available: true }] })).toBe(300);
    expect(fromPrice(base)).toBe(12000);
  });
});
