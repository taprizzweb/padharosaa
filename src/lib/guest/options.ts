/** Sizes and options of a dish: pure helpers shared by the menu, the cart and the tests. The server re-checks and prices everything itself. */
import type { MenuItem } from './types';

export const isCustomisable = (item: MenuItem): boolean => (item.variants?.length ?? 0) > 0 || (item.option_groups?.length ?? 0) > 0;

/** One cart line per dish + size + set of options. Option order does not matter. */
export function lineKey(itemId: string, variantId?: string | null, optionIds?: readonly string[] | null): string {
  const opts = [...(optionIds ?? [])].sort();
  return !variantId && opts.length === 0 ? itemId : `${itemId}|${variantId ?? ''}|${opts.join(',')}`;
}

export type SelectionProblem = 'size' | 'required' | 'max' | 'unknown' | 'soldout';

/** What is wrong with a choice of size and options, or null when it can be ordered. */
export function selectionProblem(item: MenuItem, variantId?: string | null, optionIds: readonly string[] = []): { problem: SelectionProblem; group?: string } | null {
  const variants = item.variants ?? [];
  if (variants.length > 0) {
    if (!variantId) return { problem: 'size' };
    const v = variants.find((x) => x.id === variantId);
    if (!v) return { problem: 'unknown' };
    if (!v.is_available) return { problem: 'soldout' };
  } else if (variantId) {
    return { problem: 'unknown' };
  }
  const groups = item.option_groups ?? [];
  const chosen = new Set(optionIds);
  if (chosen.size !== optionIds.length) return { problem: 'unknown' };
  const known = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
  if ([...chosen].some((id) => !known.has(id))) return { problem: 'unknown' };
  for (const g of groups) {
    const n = g.options.filter((o) => chosen.has(o.id)).length;
    if (n > g.max_select) return { problem: 'max', group: g.name };
    if (g.required && n === 0) return { problem: 'required', group: g.name };
  }
  return null;
}

/** Price of one unit in paise (size price, or the dish price, plus the chosen extras), or null when the choice is not valid. */
export function unitPrice(item: MenuItem, variantId?: string | null, optionIds: readonly string[] = []): number | null {
  if (selectionProblem(item, variantId, optionIds)) return null;
  const base = variantId ? item.variants!.find((v) => v.id === variantId)!.price_paise : item.price_paise;
  const chosen = new Set(optionIds);
  const extra = (item.option_groups ?? []).flatMap((g) => g.options).filter((o) => chosen.has(o.id)).reduce((n, o) => n + o.price_delta_paise, 0);
  return base + extra;
}

/** "Large · Extra Oreo, Choco chips" for the cart; '' for a plain dish. */
export function lineLabel(item: MenuItem, variantId?: string | null, optionIds: readonly string[] = []): string {
  const parts: string[] = [];
  const v = variantId ? item.variants?.find((x) => x.id === variantId) : undefined;
  if (v) parts.push(v.name);
  const chosen = new Set(optionIds);
  const names = (item.option_groups ?? []).flatMap((g) => g.options).filter((o) => chosen.has(o.id)).map((o) => o.name);
  if (names.length) parts.push(names.join(', '));
  return parts.join(' · ');
}

/** The lowest price the guest can pay for the dish (its cheapest available size). */
export function fromPrice(item: MenuItem): number {
  const open = (item.variants ?? []).filter((v) => v.is_available);
  return open.length > 0 ? Math.min(...open.map((v) => v.price_paise)) : item.price_paise;
}
