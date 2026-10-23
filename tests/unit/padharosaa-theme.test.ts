import { describe, expect, it } from 'vitest';
import { buildTheme, contrast, isHexColour, luminance, mix, normaliseHex, themeVars } from '@/lib/padharosaa/theme';

describe('normaliseHex', () => {
  it('accepts 6 and 3 digit colours in any case, and falls back for anything else', () => {
    expect(normaliseHex('#AABBCC')).toBe('#aabbcc');
    expect(normaliseHex('#abc')).toBe('#aabbcc');
    for (const bad of ['', 'red', '#12345', '#GGGGGG', 'javascript:alert(1)', '#ff0000; background:url(x)', null, undefined]) expect(normaliseHex(bad as never)).toBe('#b05545');
    expect(isHexColour('#b05545')).toBe(true);
    expect(isHexColour('#b05')).toBe(false);
  });
});

describe('contrast maths', () => {
  it('matches the known extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(luminance('#ffffff')).toBeCloseTo(1, 3);
  });
  it('mix is a straight blend', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#ff0000', '#0000ff', 1)).toBe('#ff0000');
  });
});

describe('buildTheme: every text pair is readable for ANY colour the hotel picks', () => {
  const hexOf = (h: number, s: number, l: number) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return `#${[R, G, B].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
  };
  const picks: string[] = ['#000000', '#ffffff', '#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#808080', '#fde047', '#1d3d72', '#b85c4d'];
  for (let h = 0; h < 360; h += 15) for (const s of [0.15, 0.5, 0.9, 1]) for (const l of [0.08, 0.25, 0.4, 0.5, 0.6, 0.75, 0.92]) picks.push(hexOf(h, s, l));

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode} mode: ${picks.length} colours, all pairs reach 4.5:1`, () => {
      const bad: string[] = [];
      for (const p of picks) {
        const t = buildTheme(p, mode);
        const pairs: [string, string, string][] = [
          ['button text', t.onButton, t.button],
          ['body text', t.ink, t.paper],
          ['link/label text', t.accentText, t.paper],
          ['tinted area text', t.onTint, t.tint],
          ['hero text', t.onHero, t.gradient[0]],
          ['hero text, lower stop', t.onHero, t.gradient[1]],
        ];
        for (const [name, fg, bg] of pairs) if (contrast(fg, bg) < 4.5) bad.push(`${p} ${name} ${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('keeps the picked colour recognisable: a dark brand stays the button colour, white text on it', () => {
    const t = buildTheme('#1d3d72');
    expect(t.picked).toBe('#1d3d72');
    expect(t.button).toBe('#1d3d72');
    expect([t.onButton, t.onHero]).toEqual(['#ffffff', '#ffffff']);
  });
  it('a light brand gets dark text, a mid brand is nudged only as far as needed', () => {
    const yellow = buildTheme('#fde047');
    expect([yellow.onButton, yellow.onHero]).toEqual(['#10131a', '#10131a']);
    const mid = buildTheme('#b85c4d'); // white on it is 4.49: just under, so the button shade is darkened a touch
    expect(mid.picked).toBe('#b85c4d');
    expect(mid.button).not.toBe('#b85c4d');
    expect(contrast(mid.onButton, mid.button)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#b85c4d', mid.button)).toBeLessThan(1.3); // visually the same colour
  });
  it('themeVars only ever contains colour values (safe to place in a style attribute)', () => {
    for (const p of ['#b05545', '#00ff88', 'not a colour', '#ff0000;}body{display:none']) {
      for (const v of Object.values(themeVars(buildTheme(p)))) expect(v).toMatch(/^(#[0-9a-f]{6}|rgba\(\d+,\d+,\d+,[0-9.]+\))$/);
    }
  });
});
