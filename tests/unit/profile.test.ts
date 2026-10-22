import { describe, expect, it } from 'vitest';
import { EXPLORE_BASE, exploreUrl, normalizeExploreCode } from '@/lib/profile';
import { profileSave } from '@/lib/schemas/dash';
import { clampCenter, scaleOf, sourceRect } from '@/lib/dash/crop';

describe('explore link', () => {
  it('builds the link from the code the owner typed and nothing else', () => {
    expect(EXPLORE_BASE).toBe('https://smarty.taprizz.in/sq/');
    expect(exploreUrl('tattoo-cafe_1')).toBe('https://smarty.taprizz.in/sq/tattoo-cafe_1');
  });
  it('accepts a plain code or the whole pasted link, and nothing that could point somewhere else', () => {
    expect(normalizeExploreCode(' abc123 ')).toBe('abc123');
    expect(normalizeExploreCode('https://smarty.taprizz.in/sq/abc123')).toBe('abc123');
    expect(normalizeExploreCode('https://smarty.taprizz.in/sq/abc123/')).toBe('abc123');
    for (const bad of ['', 'a b', '../x', 'a/b', 'https://evil.example/sq/abc', 'abc?x=1', 'abc#x', '//evil.example', 'x'.repeat(65), 'javascript:alert(1)']) expect(normalizeExploreCode(bad), bad).toBe('');
  });
});

describe('profile schema', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  it('cleans values and refuses bad input', () => {
    const ok = profileSave.parse({ tagline: ' Best chai ', explore_code: 'https://smarty.taprizz.in/sq/tattoo', logo_path: `${uuid}/${uuid}.webp` });
    expect(ok).toMatchObject({ tagline: 'Best chai', explore_code: 'tattoo', banner_path: '', address: '' });
    expect(profileSave.safeParse({ explore_code: 'a/b' }).success).toBe(false);
    expect(profileSave.safeParse({ explore_code: 'https://evil.example/x' }).success).toBe(false);
    expect(profileSave.safeParse({ logo_path: '../../etc/passwd' }).success).toBe(false);
    expect(profileSave.safeParse({ phone: '9876543210' }).success).toBe(false); // the old contact fields are gone
    expect(profileSave.safeParse({ unknown: 'x' }).success).toBe(false);
  });
});

describe('crop maths', () => {
  const base = { frameW: 300, frameH: 200, imgW: 3000, imgH: 3000, zoom: 1, cx: 1500, cy: 1500 };
  it('covers the frame and never shows outside the photo', () => {
    expect(scaleOf(base)).toBeCloseTo(0.1); // 300 / 3000
    const r = sourceRect(base);
    expect(r.sw).toBeCloseTo(3000);
    expect(r.sh).toBeCloseTo(2000);
    // dragging far to the corner is held inside the photo
    const c = clampCenter({ ...base, cx: -5000, cy: 99999 });
    const e = sourceRect({ ...base, ...c });
    expect(e.sx).toBeGreaterThanOrEqual(0);
    expect(e.sy + e.sh).toBeLessThanOrEqual(3000 + 1e-9);
  });
  it('zooming in shows a smaller part of the photo', () => {
    const z = sourceRect({ ...base, zoom: 2 });
    expect(z.sw).toBeCloseTo(1500);
    expect(z.sh / z.sw).toBeCloseTo(200 / 300);
    const wide = sourceRect({ frameW: 300, frameH: 300, imgW: 4000, imgH: 2000, zoom: 1, cx: 2000, cy: 1000 });
    expect(wide.sw).toBeCloseTo(2000);
    expect(wide.sh).toBeCloseTo(2000);
  });
});

import { instagramUrl, POWERED_BY } from '@/lib/brand';
describe('footer credit', () => {
  it('links only to a plain Instagram handle', () => {
    expect(POWERED_BY.name).toBe('Taprizz');
    expect(instagramUrl('taprizz.in')).toBe('https://www.instagram.com/taprizz.in');
    expect(instagramUrl('@taprizz.in')).toBe('https://www.instagram.com/taprizz.in');
    for (const bad of ['', 'a b', 'a/b', 'https://evil.example', 'x'.repeat(31), 'a?b=1', 'javascript:alert(1)']) expect(instagramUrl(bad), bad).toBeNull();
  });
});
