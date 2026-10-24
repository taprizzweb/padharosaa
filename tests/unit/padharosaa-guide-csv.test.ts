import { describe, expect, it } from 'vitest';
import { GUIDE_CSV_SAMPLE, parseGuideCsv } from '@/lib/padharosaa/csv';

describe('guide CSV', () => {
  it('reads the sample: quotes keep commas, the header is skipped, a bare website gets https', () => {
    const { rows, bad } = parseGuideCsv(GUIDE_CSV_SAMPLE);
    expect(bad).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ category: 'place', name: 'Amer Fort', best_time: 'Early morning', lat: null, lng: null });
    expect(rows[0]!.description_en).toContain('palaces, mirror hall');
    expect(rows[1]).toMatchObject({ category: 'food', link_url: 'https://lmbmisthanbhandar.com', lat: 26.9168, lng: 75.8276 });
  });
  it('only a name is required; unknown type means place; windows line ends and a BOM are fine', () => {
    const { rows } = parseGuideCsv('﻿Jal Mahal\r\nBapu Bazaar,Shopping\r\n');
    expect(rows.map((r) => [r.name, r.category])).toEqual([['Jal Mahal', 'place'], ['Bapu Bazaar', 'craft']]);
  });
  it('skips rows with no name, half a location or numbers out of range, and counts them', () => {
    const { rows, bad } = parseGuideCsv(',place\nA,place,,,,,,26.9,\nB,place,,,,,,95,75\nC,place,,,,,,26.9,75.8\n"He said ""hi""",tip');
    expect(rows.map((r) => r.name)).toEqual(['C', 'He said "hi"']);
    expect(bad).toBe(3);
  });
});
