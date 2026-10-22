import { describe, expect, it } from 'vitest';
import { MAX_CSV_ROWS, SAMPLE_CSV, csvCell, menuToCsv, parseCsv, parseMenuCsv } from '@/lib/dash/csv';

const H = 'category,name,description,price,diet,spice,bestseller,chef_pick,available';

describe('CSV parser', () => {
  it('handles quotes, commas and line breaks inside quotes, escaped quotes, BOM and CRLF', () => {
    const t = parseCsv('﻿a,b\r\n"x, y","line1\nline2"\r\n"say ""hi""",z\r\n');
    expect(t).toEqual([['a', 'b'], ['x, y', 'line1\nline2'], ['say "hi"', 'z']]);
  });
  it('ignores blank lines, keeps empty cells, and has no trailing-newline surprises', () => {
    expect(parseCsv('a,b,c\n\n1,,3\n')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('refuses a quote that is never closed', () => {
    expect(() => parseCsv('a,"oops\n1,2')).toThrow(/never closed/);
  });
});

describe('menu CSV import', () => {
  it('parses a good file with defaults for the optional columns', () => {
    const r = parseMenuCsv(`category,name,price\nStarters,Paneer Tikka,280\nDrinks,Tea,40.5`);
    expect(r.fatal).toBeNull();
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      { category: 'Starters', name: 'Paneer Tikka', description: '', price_paise: 28000, diet: 'veg', spice: 0, bestseller: false, chef_pick: false, available: true },
      { category: 'Drinks', name: 'Tea', description: '', price_paise: 4050, diet: 'veg', spice: 0, bestseller: false, chef_pick: false, available: true },
    ]);
  });
  it('the downloadable sample is itself a valid file', () => {
    const r = parseMenuCsv(SAMPLE_CSV);
    expect(r.issues).toEqual([]);
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]!.description).toContain('spiced yoghurt, charred');
    expect(r.rows[2]!.sizes).toEqual([{ name: 'Small', price_paise: 12000 }, { name: 'Medium', price_paise: 16000 }, { name: 'Large', price_paise: 20000 }, { name: 'XL', price_paise: 24000 }]);
  });
  it('accepts friendly spellings: columns in any order and case, diet names, yes/no, rupee signs and commas', () => {
    const r = parseMenuCsv(`Price (Rs),NAME,Category,Diet,Spice,Best Seller,Chef's Pick,Is Available\n"₹1,200.00",Thali,Meals,Non-Veg,3,YES,y,no`);
    expect(r.issues).toEqual([]);
    expect(r.rows[0]).toMatchObject({ price_paise: 120000, diet: 'nonveg', spice: 3, bestseller: true, chef_pick: true, available: false });
  });
  it('reports every problem with the row number (header is row 1)', () => {
    const r = parseMenuCsv(`${H}\nA,Good,,100,veg,1,no,no,yes\nA,,,abc,beef,9,maybe,,\n,NoCat,,1e3,veg,0,,,\nA,good,,50,veg,0,,,`);
    expect(r.rows).toHaveLength(1);
    expect(r.issues.map((i) => i.row)).toEqual([3, 4, 5]);
    const m3 = r.issues[0]!.messages.join(' | ');
    for (const part of ['Name must', 'Price must', 'Diet must', 'Spice must', 'Bestseller must']) expect(m3).toContain(part);
    expect(r.issues[1]!.messages.join(' ')).toContain('Category must');
    expect(r.issues[2]!.messages.join(' ')).toContain('already listed on row 2'); // duplicates ignore case
    expect(r.preview).toHaveLength(4);
    expect(r.preview.filter((p) => p.ok)).toHaveLength(1);
  });
  it('enforces length and price limits', () => {
    const r = parseMenuCsv(`${H}\n${'c'.repeat(61)},N,,1,veg,0,,,\nC,${'n'.repeat(81)},,1,veg,0,,,\nC,D,${'d'.repeat(301)},1,veg,0,,,\nC,P,,100001,veg,0,,,\nC,Free,,0,veg,0,,,\nC,Max,,100000,veg,0,,,`);
    expect(r.issues.map((i) => i.row)).toEqual([2, 3, 4, 5]);
    expect(r.rows.map((x) => x.name)).toEqual(['Free', 'Max']);
  });
  it('rejects unusable files as a whole, with a plain message', () => {
    expect(parseMenuCsv('').fatal).toMatch(/empty/);
    expect(parseMenuCsv(`${H}`).fatal).toMatch(/no dishes/);
    expect(parseMenuCsv('name,price\nTea,40').fatal).toMatch(/Missing: category/);
    expect(parseMenuCsv(`${H}\n` + Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => `C,Dish ${i},,1,veg,0,,,`).join('\n')).fatal).toMatch(/limit is 500/);
    expect(parseMenuCsv(`${H}\nC,"broken,1,veg`).fatal).toMatch(/never closed/);
    expect(parseMenuCsv('x'.repeat(250 * 1024)).fatal).toMatch(/200 KB/);
    expect(parseMenuCsv(`${H}\n` + Array.from({ length: MAX_CSV_ROWS }, (_, i) => `C,Dish ${i},,1,veg,0,,,`).join('\n')).fatal).toBeNull();
  });
});

describe('menu CSV export', () => {
  it('protects against spreadsheet formula injection', () => {
    for (const bad of ['=HYPERLINK("http://evil")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd']) {
      expect(csvCell(bad), bad).toMatch(/^"?'/);
    }
    expect(csvCell('Paneer Tikka')).toBe('Paneer Tikka');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(250)).toBe('250');
  });
  it('exports in the same format it imports (round trip), with rupees not paise', () => {
    const menu = {
      categories: [
        { name: 'Starters', items: [{ name: 'Tikka, spicy', description: 'Hot "tandoor"\nsmoky', price_paise: 28050, diet: 'veg', spice: 2, is_bestseller: true, is_chef_pick: false, is_available: true }] },
        { name: 'Drinks', items: [{ name: '=cmd', description: null, price_paise: 4000, diet: 'jain', spice: 0, is_bestseller: false, is_chef_pick: true, is_available: false }] },
      ],
    };
    const csv = menuToCsv(menu);
    expect(csv.split('\r\n')[0]).toBe('category,name,description,price,diet,spice,bestseller,chef_pick,available,sizes');
    expect(csv).toContain('280.50');
    expect(csv).toContain(',40,');
    const back = parseMenuCsv(csv);
    expect(back.issues).toEqual([]);
    expect(back.rows).toEqual([
      { category: 'Starters', name: 'Tikka, spicy', description: 'Hot "tandoor"\nsmoky', price_paise: 28050, diet: 'veg', spice: 2, bestseller: true, chef_pick: false, available: true },
      { category: 'Drinks', name: '=cmd', description: '', price_paise: 4000, diet: 'jain', spice: 0, bestseller: false, chef_pick: true, available: false },
    ]);
  });
});

describe('sizes in the CSV', () => {
  const h = 'category,name,price,sizes';
  it('reads sizes, uses the cheapest as the price when the price is empty, and keeps a given price', () => {
    const r = parseMenuCsv(`${h}\nDrinks,Oreo Shake,,Small:120|Medium:160.50|Large:200\nMeals,Biryani,250,Half:150|Full:280`);
    expect(r.issues).toEqual([]);
    expect(r.rows[0]).toMatchObject({ price_paise: 12000, sizes: [{ name: 'Small', price_paise: 12000 }, { name: 'Medium', price_paise: 16050 }, { name: 'Large', price_paise: 20000 }] });
    expect(r.rows[1]).toMatchObject({ price_paise: 25000, sizes: [{ name: 'Half', price_paise: 15000 }, { name: 'Full', price_paise: 28000 }] });
  });
  it('a file with a sizes column does not need a price column', () => {
    expect(parseMenuCsv('category,name,sizes\nDrinks,Shake,S:10|L:20').issues).toEqual([]);
    expect(parseMenuCsv('category,name\nDrinks,Shake').fatal).toMatch(/Missing: price/);
  });
  it('refuses broken, repeated or too many sizes with a clear message', () => {
    const bad = ['Small', 'Small:', ':120', 'Small:abc', 'Small:120|small:130', Array.from({ length: 9 }, (_, i) => `S${i}:1`).join('|'), `${'x'.repeat(31)}:5`, 'Small:-5'];
    for (const cell of bad) {
      const r = parseMenuCsv(`${h}\nDrinks,Shake,100,${cell}`);
      expect(r.issues.length, cell).toBe(1);
    }
    expect(parseMenuCsv(`${h}\nDrinks,Shake,,`).issues[0]?.messages[0]).toMatch(/Price must be/);
  });
  it('exports sizes in the same cell format and reads them back unchanged', () => {
    const csv = menuToCsv({ categories: [{ name: 'Drinks', items: [{ name: 'Shake', description: null, price_paise: 12000, diet: 'veg', spice: 0, is_bestseller: false, is_chef_pick: false, is_available: true, variants: [{ name: 'Small', price_paise: 12000 }, { name: 'Large', price_paise: 20050 }] }] }] });
    expect(csv).toContain('Small:120|Large:200.50');
    expect(parseMenuCsv(csv).rows[0]!.sizes).toEqual([{ name: 'Small', price_paise: 12000 }, { name: 'Large', price_paise: 20050 }]);
  });
});
