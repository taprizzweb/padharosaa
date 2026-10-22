import { parseRupeesToPaise } from '@/lib/money';

/** Menu CSV: parse (with per-row errors), validate, and export. Pure functions: no browser, no database. */

export const MAX_CSV_ROWS = 500;
export const MAX_CSV_BYTES = 200 * 1024;
export const CSV_HEADERS = ['category', 'name', 'description', 'price', 'diet', 'spice', 'bestseller', 'chef_pick', 'available', 'sizes'] as const;
/** The `sizes` cell: `Small:120|Medium:160|Large:200` (name, a colon, the price in rupees; sizes separated by |). */
export const MAX_SIZES = 8;

export interface ImportRow {
  category: string;
  name: string;
  description: string;
  price_paise: number;
  diet: 'veg' | 'nonveg' | 'egg' | 'jain';
  spice: number;
  bestseller: boolean;
  chef_pick: boolean;
  available: boolean;
  /** only present when the file gave sizes */
  sizes?: { name: string; price_paise: number }[];
}
export interface RowIssue {
  /** spreadsheet row number: the header is row 1, the first dish is row 2 */
  row: number;
  messages: string[];
}
export interface ParsedMenuCsv {
  rows: ImportRow[];
  /** every data row, valid or not, for the preview table */
  preview: { row: number; cells: Record<string, string>; ok: boolean; messages: string[] }[];
  issues: RowIssue[];
  /** set when the file as a whole cannot be used (empty, missing columns, too big...) */
  fatal: string | null;
}

/** RFC 4180 style parser: quotes, escaped quotes, commas and line breaks inside quotes, BOM, CRLF. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
    i++;
  }
  if (quoted) throw new Error('A quoted value is never closed (check for a missing " character).');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const DIETS: Record<string, ImportRow['diet']> = { veg: 'veg', vegetarian: 'veg', nonveg: 'nonveg', 'non-veg': 'nonveg', 'non veg': 'nonveg', 'non-vegetarian': 'nonveg', egg: 'egg', jain: 'jain' };
const TRUE = new Set(['yes', 'y', 'true', '1']);
const FALSE = new Set(['no', 'n', 'false', '0', '']);

/** A leading apostrophe is how export protects text that spreadsheets would run as a formula; remove it on the way back in. */
const unprotect = (s: string) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

/** "Half:150|Full:280" -> sizes, or an error text. An empty cell means no sizes. */
export function parseSizes(cell: string): { sizes: { name: string; price_paise: number }[] } | { error: string } {
  const out: { name: string; price_paise: number }[] = [];
  for (const part of cell.split('|').map((p) => p.trim()).filter(Boolean)) {
    const at = part.lastIndexOf(':');
    const name = at > 0 ? part.slice(0, at).trim() : '';
    const paise = at > 0 ? parseRupeesToPaise(part.slice(at + 1).trim()) : null;
    if (!name || name.length > 30 || paise === null || paise > 10_000_000) return { error: 'Sizes must look like Small:120|Large:200 (a name up to 30 characters, a colon, the price in rupees).' };
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) return { error: `The size "${name}" is listed twice.` };
    out.push({ name, price_paise: paise });
  }
  if (out.length > MAX_SIZES) return { error: `A dish can have up to ${MAX_SIZES} sizes.` };
  return { sizes: out };
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
const ALIASES: Record<string, string> = { size: 'sizes', variants: 'sizes', sizes_price: 'sizes', chefs_pick: 'chef_pick', chef_s_pick: 'chef_pick', price_rs: 'price', price_inr: 'price', best_seller: 'bestseller', is_available: 'available', dish: 'name', item: 'name' };

export function parseMenuCsv(text: string): ParsedMenuCsv {
  const empty = (fatal: string): ParsedMenuCsv => ({ rows: [], preview: [], issues: [], fatal });
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) return empty('This file is larger than 200 KB. Split it into smaller files.');
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    return empty((e as Error).message);
  }
  if (table.length === 0) return empty('The file is empty.');
  const header = table[0]!.map((h) => {
    const n = norm(h);
    return ALIASES[n] ?? n;
  });
  const missing = ['category', 'name'].filter((c) => !header.includes(c)).concat(header.includes('price') || header.includes('sizes') ? [] : ['price']);
  if (missing.length) return empty(`The first row must have the columns: ${CSV_HEADERS.join(', ')}. Missing: ${missing.join(', ')}.`);
  const body = table.slice(1);
  if (body.length === 0) return empty('The file has a header but no dishes.');
  if (body.length > MAX_CSV_ROWS) return empty(`The file has ${body.length} dishes; the limit is ${MAX_CSV_ROWS} per import.`);

  const rows: ImportRow[] = [];
  const preview: ParsedMenuCsv['preview'] = [];
  const issues: RowIssue[] = [];
  const seen = new Map<string, number>();

  body.forEach((cells, idx) => {
    const rowNo = idx + 2;
    const get = (col: string) => unprotect((cells[header.indexOf(col)] ?? '').trim());
    const raw: Record<string, string> = Object.fromEntries(CSV_HEADERS.map((c) => [c, get(c)]));
    const msgs: string[] = [];

    const category = raw.category!;
    const name = raw.name!;
    if (category.length < 1 || category.length > 60) msgs.push('Category must be 1 to 60 characters.');
    if (name.length < 1 || name.length > 80) msgs.push('Name must be 1 to 80 characters.');
    if (raw.description!.length > 300) msgs.push('Description is longer than 300 characters.');

    const sized = parseSizes(raw.sizes!);
    if ('error' in sized) msgs.push(sized.error);
    const sizes = 'sizes' in sized ? sized.sizes : [];
    // a dish with sizes may leave the price empty: it then shows the cheapest size
    const cheapest = sizes.length ? Math.min(...sizes.map((s) => s.price_paise)) : null;
    const paise = raw.price === '' ? cheapest : parseRupeesToPaise(raw.price!);
    if (paise === null) msgs.push('Price must be a number of rupees, like 250 or 250.50.');
    else if (paise > 10_000_000) msgs.push('Price cannot be more than ₹1,00,000.');

    const diet = raw.diet === '' ? 'veg' : DIETS[raw.diet!.toLowerCase()];
    if (!diet) msgs.push('Diet must be veg, nonveg, egg or jain.');

    const spiceText = raw.spice === '' ? '0' : raw.spice!;
    const spice = /^[0-3]$/.test(spiceText) ? Number(spiceText) : null;
    if (spice === null) msgs.push('Spice must be 0, 1, 2 or 3.');

    const bool = (col: string, label: string, dflt: boolean): boolean => {
      const v = raw[col]!.toLowerCase();
      if (v === '' && dflt) return true;
      if (TRUE.has(v)) return true;
      if (FALSE.has(v)) return false;
      msgs.push(`${label} must be yes or no.`);
      return dflt;
    };
    const bestseller = bool('bestseller', 'Bestseller', false);
    const chef_pick = bool('chef_pick', 'Chef pick', false);
    const available = bool('available', 'Available', true);

    const key = `${category.toLowerCase()}|${name.toLowerCase()}`;
    if (category && name) {
      const first = seen.get(key);
      if (first) msgs.push(`This dish is already listed on row ${first}.`);
      else seen.set(key, rowNo);
    }

    preview.push({ row: rowNo, cells: raw, ok: msgs.length === 0, messages: msgs });
    if (msgs.length) issues.push({ row: rowNo, messages: msgs });
    else rows.push({ category, name, description: raw.description!, price_paise: paise!, diet: diet!, spice: spice!, bestseller, chef_pick, available, ...(sizes.length ? { sizes } : {}) });
  });

  return { rows, preview, issues, fatal: null };
}

/** Text that a spreadsheet would treat as a formula gets a leading apostrophe (CSV injection protection). */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ExportMenu {
  categories: { name: string; items: { name: string; description: string | null; price_paise: number; diet: string; spice: number; is_bestseller: boolean; is_chef_pick: boolean; is_available: boolean; variants?: { name: string; price_paise: number }[] }[] }[];
}

export function menuToCsv(menu: ExportMenu): string {
  const rupees = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const c of menu.categories) {
    for (const i of c.items) {
      lines.push([c.name, i.name, i.description ?? '', rupees(i.price_paise), i.diet, i.spice, i.is_bestseller ? 'yes' : 'no', i.is_chef_pick ? 'yes' : 'no', i.is_available ? 'yes' : 'no', (i.variants ?? []).map((v) => `${v.name}:${rupees(v.price_paise)}`).join('|')].map(csvCell).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/** A short sample the owner can download, edit in Excel / Google Sheets, and upload. */
export const SAMPLE_CSV =
  `${CSV_HEADERS.join(',')}\r\n` +
  'Starters,Paneer Tikka,"Cottage cheese marinated in spiced yoghurt, charred in the tandoor",280,veg,2,yes,no,yes,\r\n' +
  'Main Course,Butter Chicken,Tandoori chicken in a velvety tomato-butter gravy,,nonveg,1,yes,no,yes,Half:220|Full:340\r\n' +
  'Beverages,Oreo Shake,,,veg,0,no,no,yes,Small:120|Medium:160|Large:200|XL:240\r\n' +
  'Beverages,Masala Chai,,40,veg,0,no,no,yes,\r\n';
