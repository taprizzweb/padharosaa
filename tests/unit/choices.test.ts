import { describe, expect, it } from 'vitest';
import { choicesPayload, draftsFromItem, type Drafts } from '@/lib/dash/choices';
import { itemChoicesSave } from '@/lib/schemas/dash';

const empty: Drafts = { variants: [], groups: [] };
const okDrafts: Drafts = {
  variants: [{ name: ' Small ', price: '120', available: true }, { name: 'Large', price: '200.50', available: false }],
  groups: [{ name: 'Sauce', required: true, max: '1', options: [{ name: 'Peri peri', price: '' }, { name: 'Cheese dip', price: '20' }] }],
};

describe('dish editor: sizes and options', () => {
  it('turns what the owner typed into a request, in paise, with the cheapest size', () => {
    const r = choicesPayload(okDrafts);
    expect(r).toEqual({
      ok: true,
      cheapest: 12000,
      variants: [{ name: 'Small', price_paise: 12000, is_available: true }, { name: 'Large', price_paise: 20050, is_available: false }],
      groups: [{ name: 'Sauce', required: true, max_select: 1, options: [{ name: 'Peri peri', price_delta_paise: 0 }, { name: 'Cheese dip', price_delta_paise: 2000 }] }],
    });
    expect(choicesPayload(empty)).toEqual({ ok: true, variants: [], groups: [], cheapest: null });
  });
  it('the request passes the server schema', () => {
    const r = choicesPayload(okDrafts);
    if (!r.ok) throw new Error('expected ok');
    expect(itemChoicesSave.safeParse({ item_id: '11111111-1111-4111-8111-111111111111', variants: r.variants, groups: r.groups }).success).toBe(true);
    expect(itemChoicesSave.safeParse({ item_id: '11111111-1111-4111-8111-111111111111', variants: [], groups: [{ name: 'G', required: true, max_select: 3, options: [{ name: 'a', price_delta_paise: 0 }] }] }).success).toBe(false);
  });
  it('keeps ids of rows that already exist so they are updated in place', () => {
    const saved = draftsFromItem({ variants: [{ id: 'v1', name: 'Small', price_paise: 12000, is_available: true }], groups: [{ id: 'g1', name: 'Sauce', required: false, max_select: 1, options: [{ id: 'o1', name: 'Mayo', price_delta_paise: 1550 }] }] });
    expect(saved.variants[0]).toEqual({ id: 'v1', name: 'Small', price: '120', available: true });
    expect(saved.groups[0]!.options[0]).toEqual({ id: 'o1', name: 'Mayo', price: '15.50' });
    const r = choicesPayload(saved);
    expect(r.ok && r.variants[0]!.id).toBe('v1');
    expect(r.ok && r.groups[0]!.options[0]!.id).toBe('o1');
  });
  it('explains each mistake in plain words', () => {
    const msg = (d: Drafts) => (choicesPayload(d) as { ok: false; error: string }).error;
    expect(msg({ ...empty, variants: [{ name: '', price: '10', available: true }] })).toMatch(/needs a name/);
    expect(msg({ ...empty, variants: [{ name: 'S', price: '', available: true }] })).toMatch(/price of "S"/);
    expect(msg({ ...empty, variants: [{ name: 'S', price: 'abc', available: true }] })).toMatch(/price of "S"/);
    expect(msg({ ...empty, variants: [{ name: 'S', price: '1', available: true }, { name: 's', price: '2', available: true }] })).toMatch(/same name/);
    expect(msg({ ...empty, variants: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, price: '1', available: true })) })).toMatch(/up to 8 sizes/);
    const g = (over: Partial<Drafts['groups'][number]>) => ({ ...empty, groups: [{ name: 'G', required: false, max: '1', options: [{ name: 'a', price: '' }], ...over }] });
    expect(msg(g({ name: ' ' }))).toMatch(/needs a title/);
    expect(msg(g({ options: [] }))).toMatch(/at least one choice/);
    expect(msg(g({ options: [{ name: '', price: '' }] }))).toMatch(/needs a name/);
    expect(msg(g({ options: [{ name: 'a', price: 'x' }] }))).toMatch(/extra price/);
    expect(msg(g({ options: [{ name: 'a', price: '' }, { name: 'A', price: '' }], max: '1' }))).toMatch(/same name/);
    expect(msg(g({ max: '0' }))).toMatch(/between 1 and 1/);
    expect(msg(g({ max: '2' }))).toMatch(/between 1 and 1/);
    expect(msg(g({ max: '1.5' }))).toMatch(/between 1 and 1/);
    expect(msg({ ...empty, groups: [g({}).groups[0]!, g({}).groups[0]!] })).toMatch(/same title/);
  });
});
