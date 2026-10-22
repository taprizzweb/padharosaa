/**
 * The only accent colours an owner can pick. Each has white text on top of it in buttons, so each must reach
 * WCAG AA contrast (4.5:1) against white; tests/unit/accent.test.ts enforces that.
 * The same hex values are declared as CSS variables in globals.css (keep them in sync; the test checks it).
 */
export const ACCENTS = {
  saffron: '#b45309',
  tomato: '#c2410c',
  emerald: '#047857',
  teal: '#0f766e',
  indigo: '#4338ca',
  plum: '#86198f',
  rose: '#be123c',
  slate: '#334155',
} as const;
export type AccentKey = keyof typeof ACCENTS;
export const isAccent = (v: unknown): v is AccentKey => typeof v === 'string' && Object.hasOwn(ACCENTS, v);

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
