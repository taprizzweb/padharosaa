import type { Diet, MenuCategory, MenuItem } from './types';

/** The chips above the menu, in the order they are shown. */
export const FILTERS = ['veg', 'nonveg', 'jain', 'bar', 'bestseller'] as const;
export type Filter = (typeof FILTERS)[number];

/** A bar category is named "Bar - ..." (for example "Bar - Wine - Red"). Its dishes are drinks and carry no veg or non-veg mark. */
export const isBarCategory = (name: string): boolean => /^\s*bar\s*[-–—]/i.test(name);

/** Ids of the dishes that sit in a bar category. */
export function barItemIds(categories: MenuCategory[]): Set<string> {
  return new Set(categories.filter((c) => isBarCategory(c.name_en)).flatMap((c) => c.items.map((i) => i.id)));
}

/** The mark to show before a dish name: its diet, or nothing for a bar dish. */
export const markFor = (item: Pick<MenuItem, 'id' | 'diet'>, bar: ReadonlySet<string>): Diet | null => (bar.has(item.id) ? null : item.diet);

/** Tapping a chip. Veg and Non-Veg cannot both be on: choosing one turns the other off. */
export function toggleFilter(cur: ReadonlySet<Filter>, f: Filter): Set<Filter> {
  const n = new Set(cur);
  if (n.has(f)) { n.delete(f); return n; }
  n.add(f);
  if (f === 'veg') n.delete('nonveg');
  if (f === 'nonveg') n.delete('veg');
  return n;
}

/**
 * Does one dish pass every active chip (all of them must match)?
 *  - Veg also shows Jain dishes; Non-Veg is diet "nonveg"; Jain is Jain only; Bestsellers is the bestseller flag.
 *  - Bar shows only dishes of bar categories. Bar dishes are stored as "veg", so without the Bar chip a diet chip never shows them,
 *    and with the Bar chip no diet check is made on them.
 */
export function passesFilters(item: Pick<MenuItem, 'diet' | 'is_bestseller'>, inBar: boolean, filters: ReadonlySet<Filter>): boolean {
  const dietChip = filters.has('veg') || filters.has('nonveg') || filters.has('jain');
  if (filters.has('bar') && !inBar) return false;
  if (inBar && dietChip && !filters.has('bar')) return false;
  if (!inBar) {
    if (filters.has('veg') && item.diet !== 'veg' && item.diet !== 'jain') return false;
    if (filters.has('nonveg') && item.diet !== 'nonveg') return false;
    if (filters.has('jain') && item.diet !== 'jain') return false;
  }
  if (filters.has('bestseller') && !item.is_bestseller) return false;
  return true;
}

/** Category chips: when Veg, Non-Veg or Bar is on, a category with no matching dish is hidden. Other times every category stays. */
export function categoryHasMatch(category: MenuCategory, filters: ReadonlySet<Filter>): boolean {
  if (!(filters.has('veg') || filters.has('nonveg') || filters.has('bar'))) return true;
  const bar = isBarCategory(category.name_en);
  return category.items.some((i) => passesFilters(i, bar, filters));
}

/** The chips a page address can ask for (?diet=veg,nonveg,jain,bar,bestseller). */
export const parseDietParam = (raw: string | null): Filter[] => (raw ?? '').split(',').filter((x): x is Filter => (FILTERS as readonly string[]).includes(x));

/** What a category holds, as the pick-what-you-feel-like page knows it: whether it is a bar category and every (diet, bestseller) pair among its dishes. */
export interface CategorySummary { bar: boolean; combos: { diet: Diet; best: boolean }[] }

/** Same rule as categoryHasMatch, for the summary the Dining page gets (it does not receive the dishes themselves). */
export function summaryHasMatch(c: CategorySummary, filters: ReadonlySet<Filter>): boolean {
  if (!(filters.has('veg') || filters.has('nonveg') || filters.has('bar'))) return true;
  return c.combos.some((x) => passesFilters({ diet: x.diet, is_bestseller: x.best }, c.bar, filters));
}

/** Boil a category down to its summary (only dishes that can be ordered). */
export function summarise(c: MenuCategory): CategorySummary {
  const seen = new Set<string>(); const combos: CategorySummary['combos'] = [];
  for (const i of c.items) { if (!i.is_available) continue; const k = `${i.diet}:${i.is_bestseller}`; if (!seen.has(k)) { seen.add(k); combos.push({ diet: i.diet, best: !!i.is_bestseller }); } }
  return { bar: isBarCategory(c.name_en), combos };
}

/** The few big sections a guest first chooses from (Food, Drinks, Bar, Desserts), so a menu of 40 categories is never one long list. */
export const SECTIONS = ['food', 'drinks', 'bar', 'dessert'] as const;
export type Section = (typeof SECTIONS)[number];
export function sectionOf(name: string): Section {
  const n = name.trim();
  if (isBarCategory(n)) return 'bar';
  if (/^(shakes?|coffee|tea|beverages?|juices?|mocktails?|smoothies?|drinks?|lassi)\b/i.test(n)) return 'drinks';
  if (/^(desserts?|sweets?|ice ?creams?)\b/i.test(n)) return 'dessert';
  return 'food';
}
/** The family a category belongs to: "Starters - Veg" and "Starters - Non-Veg" are both "Starters"; "Bar - Wine - Red" is "Wine". */
export function groupOf(name: string): string {
  const parts = name.split(/\s+[-–—]\s+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return name.trim();
  if (isBarCategory(name) && parts.length > 1) return parts[1]!;
  return parts[0]!;
}
export interface PickGroup { key: string; label: string; section: Section; ids: string[] }
/** Group the categories of a menu into sections and families (the same family under one chip). */
export function pickGroups(cats: { id: string; name: string }[]): PickGroup[] {
  const map = new Map<string, PickGroup>();
  for (const c of cats) {
    const section = sectionOf(c.name); const label = groupOf(c.name); const key = `${section}:${label.toLowerCase()}`;
    const g = map.get(key); if (g) g.ids.push(c.id); else map.set(key, { key, label, section, ids: [c.id] });
  }
  return [...map.values()];
}
