import { describe, expect, it } from 'vitest';
import { barItemIds, categoryHasMatch, isBarCategory, markFor, parseDietParam, passesFilters, toggleFilter, type Filter } from '@/lib/guest/filters';
import type { Diet, MenuCategory, MenuItem } from '@/lib/guest/types';

const item = (id: string, diet: Diet, extra: Partial<MenuItem> = {}): MenuItem => ({ id, name_en: id, description_en: null, price_paise: 100, diet, spice: 0, image_path: null, is_available: true, is_bestseller: false, is_chef_pick: false, ...extra });
const cats: MenuCategory[] = [
  { id: 'c1', name_en: 'Starters - Veg', items: [item('paneer', 'veg', { is_bestseller: true }), item('jainroll', 'jain')] },
  { id: 'c2', name_en: 'Soup - Non-Veg', items: [item('chickensoup', 'nonveg', { is_bestseller: true })] },
  { id: 'c3', name_en: 'Bar - Beer', items: [item('lager', 'veg', { is_bestseller: true })] },
  { id: 'c4', name_en: 'Bar - Wine - Red', items: [item('merlot', 'veg')] },
  { id: 'c5', name_en: 'Desserts', items: [item('halwa', 'veg')] },
];
const all = cats.flatMap((c) => c.items.map((i) => ({ i, bar: isBarCategory(c.name_en), cat: c })));
const names = (f: Filter[]) => all.filter((x) => passesFilters(x.i, x.bar, new Set(f))).map((x) => x.i.id);

describe('menu filter chips', () => {
  it('a bar category starts with "Bar -"; other names that merely contain bar do not count', () => {
    expect(['Bar - Wine - Red', 'bar - beer', ' Bar – Whisky'].every(isBarCategory)).toBe(true);
    expect(['Barbecue', 'Starters - Bar', 'Rebar - x', 'Desserts'].some(isBarCategory)).toBe(false);
    expect([...barItemIds(cats)].sort()).toEqual(['lager', 'merlot']);
  });
  it('no chip shows everything', () => expect(names([])).toHaveLength(6));
  it('Non-Veg alone: only nonveg dishes, never a bar dish', () => expect(names(['nonveg'])).toEqual(['chickensoup']));
  it('Veg alone: veg and Jain dishes, never a bar dish (bar dishes are stored as veg)', () => expect(names(['veg'])).toEqual(['paneer', 'jainroll', 'halwa']));
  it('Jain alone: only Jain dishes', () => expect(names(['jain'])).toEqual(['jainroll']));
  it('Bar alone: every bar dish and nothing else', () => expect(names(['bar'])).toEqual(['lager', 'merlot']));
  it('Bar with Veg or Non-Veg: bar dishes stay (no diet check on them)', () => {
    expect(names(['bar', 'veg'])).toEqual(['lager', 'merlot']);
    expect(names(['bar', 'nonveg'])).toEqual(['lager', 'merlot']);
  });
  it('Veg + Bestsellers: all chips must match (AND)', () => expect(names(['veg', 'bestseller'])).toEqual(['paneer']));
  it('Bar + Bestsellers: only the bestselling bar dish', () => expect(names(['bar', 'bestseller'])).toEqual(['lager']));
  it('Non-Veg + Bestsellers', () => expect(names(['nonveg', 'bestseller'])).toEqual(['chickensoup']));
  it('Veg and Non-Veg are never on together: choosing one turns the other off', () => {
    const a = toggleFilter(new Set<Filter>(['veg', 'bestseller']), 'nonveg');
    expect([...a].sort()).toEqual(['bestseller', 'nonveg']);
    expect([...toggleFilter(a, 'veg')].sort()).toEqual(['bestseller', 'veg']);
    expect([...toggleFilter(a, 'nonveg')]).toEqual(['bestseller']); // tapping it again turns it off
  });
  it('category chips: with Veg, Non-Veg or Bar on, a category with no match is hidden; otherwise all stay', () => {
    const shown = (f: Filter[]) => cats.filter((c) => categoryHasMatch(c, new Set(f))).map((c) => c.name_en);
    expect(shown([])).toHaveLength(5);
    expect(shown(['jain'])).toHaveLength(5);
    expect(shown(['veg'])).toEqual(['Starters - Veg', 'Desserts']);
    expect(shown(['nonveg'])).toEqual(['Soup - Non-Veg']);
    expect(shown(['bar'])).toEqual(['Bar - Beer', 'Bar - Wine - Red']);
    expect(shown(['veg', 'bestseller'])).toEqual(['Starters - Veg']);
  });
  it('the mark: veg and non-veg get one, a bar dish none', () => {
    const bar = barItemIds(cats);
    expect(markFor(item('paneer', 'veg'), bar)).toBe('veg');
    expect(markFor(item('chickensoup', 'nonveg'), bar)).toBe('nonveg');
    expect(markFor(item('lager', 'veg'), bar)).toBeNull();
  });
  it('a page address can ask for veg, nonveg and jain only', () => expect(parseDietParam('veg,bar,nonveg,x,jain')).toEqual(['veg', 'nonveg', 'jain']));
});
