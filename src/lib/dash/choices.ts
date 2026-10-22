import { parseRupeesToPaise } from '@/lib/money';

/** The dish editor's sizes and options: what the owner types (drafts) and what is sent to the server. Pure, so it is unit-tested. */
export const MAX_VARIANTS = 8;
export const MAX_GROUPS = 6;
export const MAX_OPTIONS = 20;

export interface VariantDraft { id?: string; name: string; price: string; available: boolean }
export interface OptionDraft { id?: string; name: string; price: string }
export interface GroupDraft { id?: string; name: string; required: boolean; max: string; options: OptionDraft[] }
export interface Drafts { variants: VariantDraft[]; groups: GroupDraft[] }

export interface SavedChoices {
  variants?: { id: string; name: string; price_paise: number; is_available: boolean }[];
  groups?: { id: string; name: string; required: boolean; max_select: number; options: { id: string; name: string; price_delta_paise: number }[] }[];
}

const rupees = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

export const draftsFromItem = (it?: SavedChoices | null): Drafts => ({
  variants: (it?.variants ?? []).map((v) => ({ id: v.id, name: v.name, price: rupees(v.price_paise), available: v.is_available })),
  groups: (it?.groups ?? []).map((g) => ({
    id: g.id, name: g.name, required: g.required, max: String(g.max_select),
    options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price_delta_paise > 0 ? rupees(o.price_delta_paise) : '' })),
  })),
});

/** Ready-made size names; the owner only adds prices. */
export const SIZE_PRESETS: { label: string; names: string[] }[] = [
  { label: 'Small / Medium / Large', names: ['Small', 'Medium', 'Large'] },
  { label: 'S / M / L / XL', names: ['Small', 'Medium', 'Large', 'XL'] },
  { label: 'Half / Full', names: ['Half', 'Full'] },
];

export type ChoicesPayload =
  | { ok: true; variants: { id?: string; name: string; price_paise: number; is_available: boolean }[]; groups: { id?: string; name: string; required: boolean; max_select: number; options: { id?: string; name: string; price_delta_paise: number }[] }[]; cheapest: number | null }
  | { ok: false; error: string };

const dup = (names: string[]) => new Set(names.map((n) => n.toLowerCase())).size !== names.length;

/** Checks what the owner typed with plain-language messages and turns it into the request body. */
export function choicesPayload(d: Drafts): ChoicesPayload {
  if (d.variants.length > MAX_VARIANTS) return { ok: false, error: `A dish can have up to ${MAX_VARIANTS} sizes.` };
  if (d.groups.length > MAX_GROUPS) return { ok: false, error: `A dish can have up to ${MAX_GROUPS} option groups.` };
  const variants: Extract<ChoicesPayload, { ok: true }>['variants'] = [];
  for (const v of d.variants) {
    const name = v.name.trim();
    if (!name || name.length > 30) return { ok: false, error: 'Every size needs a name of up to 30 characters (for example Small).' };
    const price = parseRupeesToPaise(v.price);
    if (price === null || price > 10_000_000) return { ok: false, error: `Enter the price of "${name}" in rupees, for example 120 or 120.50.` };
    variants.push({ ...(v.id ? { id: v.id } : {}), name, price_paise: price, is_available: v.available });
  }
  if (dup(variants.map((v) => v.name))) return { ok: false, error: 'Two sizes have the same name.' };

  const groups: Extract<ChoicesPayload, { ok: true }>['groups'] = [];
  for (const g of d.groups) {
    const name = g.name.trim();
    if (!name || name.length > 40) return { ok: false, error: 'Every option group needs a title of up to 40 characters (for example "Choose your sauce").' };
    if (g.options.length < 1) return { ok: false, error: `"${name}" needs at least one choice.` };
    if (g.options.length > MAX_OPTIONS) return { ok: false, error: `"${name}" can have up to ${MAX_OPTIONS} choices.` };
    const options: Extract<ChoicesPayload, { ok: true }>['groups'][number]['options'] = [];
    for (const o of g.options) {
      const on = o.name.trim();
      if (!on || on.length > 40) return { ok: false, error: `Every choice in "${name}" needs a name of up to 40 characters.` };
      const extra = o.price.trim() === '' ? 0 : parseRupeesToPaise(o.price);
      if (extra === null || extra > 5_000_000) return { ok: false, error: `Enter the extra price of "${on}" in rupees (leave it empty for no extra charge).` };
      options.push({ ...(o.id ? { id: o.id } : {}), name: on, price_delta_paise: extra });
    }
    if (dup(options.map((o) => o.name))) return { ok: false, error: `Two choices in "${name}" have the same name.` };
    const max = Number(g.max);
    if (!Number.isInteger(max) || max < 1 || max > options.length) return { ok: false, error: `In "${name}", the number a guest can choose must be between 1 and ${options.length}.` };
    groups.push({ ...(g.id ? { id: g.id } : {}), name, required: g.required, max_select: max, options });
  }
  if (dup(groups.map((g) => g.name))) return { ok: false, error: 'Two option groups have the same title.' };
  return { ok: true, variants, groups, cheapest: variants.length ? Math.min(...variants.map((v) => v.price_paise)) : null };
}
