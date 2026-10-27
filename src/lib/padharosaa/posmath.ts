// The counter's bill, worked out the way the database does it (migration 0078), so the cashier sees the same figures before the bill is made.
// The database stays the one that decides; this is only the preview. Amounts are whole paise.
export interface TaxRule { word: string; rate_bp: number }
export interface SplitLine { amount: number; bp: number }
export interface SplitGroup { tax_bp: number; taxable_paise: number; tax_paise: number }

const half = (t: number, bp: number) => Math.floor((t * bp + 10000) / 20000);

/** The GST rate a dish falls under by the hotel's word rules, or null when no rule fits. The longest word wins; "beer" also matches "beers" but "bar" does not match "barbecue". */
export function ruleBp(rules: TaxRule[], name: string, section?: string | null): number | null {
  const hay = [name, section ?? ''].map((s) => s.toLowerCase());
  let best: TaxRule | null = null;
  for (const r of rules) {
    const re = new RegExp(`(^|[^a-z0-9])${r.word.replace(/[^a-z0-9 ]/g, '')}(s|es)?($|[^a-z0-9])`);
    if (!hay.some((h) => re.test(h))) continue;
    if (!best || r.word.length > best.word.length || (r.word.length === best.word.length && r.word < best.word)) best = r;
  }
  return best ? best.rate_bp : null;
}

/** Discount and service charge are shared over the lines in proportion to their amount (the odd paise on the first line); the tax is then worked out for each rate on its own. */
export function splitBill(lines: SplitLine[], discount: number, serviceBp: number): { service: number; taxable: number; groups: SplitGroup[]; tax: number; grand: number } {
  const sub = lines.reduce((a, l) => a + l.amount, 0);
  const empty = { service: 0, taxable: 0, groups: [], tax: 0, grand: 0 };
  if (sub <= 0 || discount < 0 || discount >= sub) return empty;
  const service = Math.floor(((sub - discount) * serviceBp + 5000) / 10000);
  const dd = lines.map((l) => Math.floor((discount * l.amount) / sub));
  dd[0] = (dd[0] ?? 0) + discount - dd.reduce((a, b) => a + b, 0);
  const net = lines.map((l, i) => l.amount - (dd[i] ?? 0));
  const sv = net.map((n) => Math.floor((service * n) / (sub - discount)));
  sv[0] = (sv[0] ?? 0) + service - sv.reduce((a, b) => a + b, 0);
  const by = new Map<number, number>();
  lines.forEach((l, i) => by.set(l.bp, (by.get(l.bp) ?? 0) + (net[i] ?? 0) + (sv[i] ?? 0)));
  const groups = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([bp, taxable]) => ({ tax_bp: bp, taxable_paise: taxable, tax_paise: bp > 0 ? 2 * half(taxable, bp) : 0 }));
  const tax = groups.reduce((a, g) => a + g.tax_paise, 0);
  const taxable = sub - discount + service;
  return { service, taxable, groups, tax, grand: taxable + tax };
}
