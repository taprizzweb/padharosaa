/**
 * One colour in, a whole readable theme out. A hotel picks any brand colour; text colours, button colours and the gradient are
 * worked out so every text/background pair reaches WCAG AA (4.5:1). Pure functions, no dependencies, safe on server and client.
 *
 * Same idea as the Smart QR page (white or dark text chosen from the colour's luminance), made stricter: when no text colour
 * reaches 4.5:1 on the picked colour, the button shade is nudged lighter or darker until it does, while the picked colour itself
 * stays in the gradient and decorations so the hotel's brand still looks like itself.
 */
export const DEFAULT_BRAND = '#b05545';
export const INK = '#10131a';
const WHITE = '#ffffff';
const PAPER_LIGHT = '#f6efe6';
const PAPER_DARK = '#17110f';

export type Rgb = { r: number; g: number; b: number };

export function normaliseHex(input: string | null | undefined): string {
  const v = (input ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return DEFAULT_BRAND;
}
export const isHexColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const toRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const toHex = ({ r, g, b }: Rgb): string => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export function luminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  const l = (max + min) / 2;
  return { h: ((h * 60) + 360) % 360, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0, l };
}
function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex({ r: (R + m) * 255, g: (G + m) * 255, b: (B + m) * 255 });
}

/** Shift only the lightness of `hex` (towards darker or lighter) until `against` reaches `min` contrast, or the end of the scale. */
function shade(hex: string, against: string, min: number, direction: 'darker' | 'lighter'): string {
  const { h, s, l } = toHsl(toRgb(hex));
  let cur = hex;
  for (let i = 0; i <= 100 && contrast(cur, against) < min; i++) {
    const nl = direction === 'darker' ? l - i / 100 : l + i / 100;
    cur = fromHsl(h, s, Math.min(1, Math.max(0, nl)));
  }
  return cur;
}
/** Mix `a` with `b`; amount is the share of `a`. */
export function mix(a: string, b: string, amount: number): string {
  const x = toRgb(a), y = toRgb(b);
  return toHex({ r: x.r * amount + y.r * (1 - amount), g: x.g * amount + y.g * (1 - amount), b: x.b * amount + y.b * (1 - amount) });
}

export interface Theme {
  /** the colour the hotel picked, normalised: used for the gradient and decoration */
  picked: string;
  /** filled buttons and selected chips: the picked colour, nudged only as far as needed for readable button text */
  button: string;
  onButton: string;
  /** outline for the button: only when the button is light, so a peach button on a peach page still reads as a button */
  buttonEdge: string;
  /** text on the top of the gradient */
  onHero: string;
  onHeroSoft: string;
  /** page background */
  paper: string;
  /** body text on paper */
  ink: string;
  /** links, times and small labels on paper (always 4.5:1 on paper) */
  accentText: string;
  /** soft tinted areas and text on them */
  tint: string;
  onTint: string;
  /** gradient stops for the hero area, top to bottom */
  gradient: [string, string, string];
}

export function buildTheme(input: string | null | undefined, mode: 'light' | 'dark' = 'light'): Theme {
  const picked = normaliseHex(input);
  const paper = mode === 'light' ? PAPER_LIGHT : PAPER_DARK;
  const ink = mode === 'light' ? INK : '#f3e9de';

  // text colour for the picked colour: whichever of white / ink reads better
  const heroBase = mode === 'light' ? picked : mix(picked, '#000000', 0.7);
  const onHero = contrast(WHITE, heroBase) >= contrast(INK, heroBase) ? WHITE : INK;
  const onHeroSoft = onHero === WHITE ? 'rgba(255,255,255,0.92)' : 'rgba(16,19,26,0.82)';
  // if neither reaches 4.5 on the picked colour, the hero uses a shade that does (white on darker, ink on lighter)
  const heroFixed = contrast(onHero, heroBase) >= 4.5 ? heroBase : shade(heroBase, onHero, 4.5, onHero === WHITE ? 'darker' : 'lighter');

  // button: same rule, applied to the button shade
  const buttonBase = mode === 'light' ? picked : shade(picked, ink, 4.5, 'lighter');
  const onButton = contrast(WHITE, buttonBase) >= contrast(INK, buttonBase) ? WHITE : INK;
  const button = contrast(onButton, buttonBase) >= 4.5 ? buttonBase : shade(buttonBase, onButton, 4.5, onButton === WHITE ? 'darker' : 'lighter');

  const accentText = contrast(picked, paper) >= 4.5 ? picked : shade(picked, paper, 4.5, mode === 'light' ? 'darker' : 'lighter');
  const tint = mix(picked, paper, mode === 'light' ? 0.14 : 0.22);
  const onTint = contrast(ink, tint) >= 4.5 ? ink : mode === 'light' ? INK : WHITE;
  const buttonEdge = onButton === WHITE ? 'rgba(16,19,26,0)' : 'rgba(16,19,26,0.55)';
  return { picked, button, onButton, buttonEdge, onHero, onHeroSoft, paper, ink, accentText, tint, onTint, gradient: [heroFixed, mix(heroFixed, paper, 0.5), paper] };
}

/** CSS custom properties for a theme, ready to put on a wrapper element's style. Values are colours only, never user text. */
export function themeVars(t: Theme): Record<string, string> {
  return {
    '--brand': t.picked, '--button': t.button, '--on-button': t.onButton, '--btn-edge': t.buttonEdge, '--on-hero': t.onHero, '--on-hero-soft': t.onHeroSoft,
    '--paper': t.paper, '--ink': t.ink, '--accent-text': t.accentText, '--tint': t.tint, '--on-tint': t.onTint,
    '--hero-0': t.gradient[0], '--hero-1': t.gradient[1], '--hero-2': t.gradient[2],
  };
}
