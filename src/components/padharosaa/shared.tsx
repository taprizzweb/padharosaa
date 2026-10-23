'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Copy } from './copy';

export async function api<T>(path: string, init?: RequestInit & { idem?: boolean }): Promise<{ ok: true; data: T } | { ok: false; status: number; key: string }> {
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init?.idem) headers['idempotency-key'] = crypto.randomUUID().replace(/-/g, '');
    const res = await fetch(`/api/padharosaa/v1/${path}`, { ...init, headers, credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, key: body?.error?.key ?? 'failed' };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, key: 'failed' };
  }
}

export const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
export const telHref = (p: string) => `tel:${p.replace(/[^+\d]/g, '')}`;
export const safeUrl = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : null);

export function Btn({ children, onClick, disabled, kind = 'solid', type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'solid' | 'soft'; type?: 'button' | 'submit' }) {
  const solid = kind === 'solid';
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={solid ? { background: 'var(--button)', color: 'var(--on-button)', boxShadow: 'inset 0 0 0 2px var(--btn-edge)' } : { background: 'var(--tint)', color: 'var(--on-tint)' }}
      className="min-h-12 w-full rounded-2xl px-4 py-3 text-base font-semibold shadow-sm transition active:scale-[0.98] disabled:opacity-60">{children}</button>
  );
}


export function Header({ title, sub, back, c }: { title: string; sub?: string; back: () => void; c: Copy }) {
  return (
    <header className="px-5 pb-3 pt-6">
      <button type="button" onClick={back} className="mb-3 min-h-11 text-sm font-semibold" style={{ color: 'var(--accent-text)' }}>← {c.back}</button>
      {sub && <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent-text)' }}>{sub}</p>}
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
    </header>
  );
}

const COOKIE_KEY = 'padh_cookies_ok';
/** First-open notice. The session cookie is strictly necessary, so this informs and records the guest's OK on this phone only. */
export function CookieNotice({ c }: { c: Copy }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem(COOKIE_KEY) !== '1'); } catch { setShow(true); }
  }, []);
  if (!show) return null;
  const accept = () => {
    try { localStorage.setItem(COOKIE_KEY, '1'); } catch { /* private mode: just hide for this visit */ }
    setShow(false);
  };
  return (
    <div role="dialog" aria-label="Cookies" className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md p-3">
      <div style={{ background: 'var(--paper)', color: 'var(--ink)', boxShadow: '0 -2px 18px rgba(0,0,0,.18), inset 0 0 0 1px var(--btn-edge)' }} className="rounded-2xl p-4">
        <p className="mb-3 text-sm">{c.cookieText}</p>
        <Btn onClick={accept}>{c.cookieOk}</Btn>
      </div>
    </div>
  );
}

// ---------- shared look of the guest screens: line icons, the haveli stencil behind the hero, the Taprizz pill ----------
const ICONS = {
  dining: ['M6 3v7M9 3v7M6 7h3M7.5 10v11', 'M17 3c-2.2 1.6-3 4-3 7h3v11'],
  services: ['M4 18h16', 'M6 18a6 6 0 0 1 12 0', 'M12 8V6M10 6h4'],
  buffet: ['M4 12h16a8 8 0 0 1-16 0z', 'M8 8c0-2 2-2 2-4', 'M13 8c0-2 2-2 2-4'],
  guide: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M15.5 8.5l-2 5-5 2 2-5z'],
  help: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8v5M12 16.2v.3'],
  wifi: ['M5 12a10 10 0 0 1 14 0', 'M8 15.2a6 6 0 0 1 8 0', 'M12 19h.01'],
  phone: ['M6 3h4l1.5 4-2 1.5a11 11 0 0 0 6 6L17.5 12.5 21 14v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z'],
  instagram: ['M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M17.5 6.5h.01'],
  owl: ['M7.5 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M16.5 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M4 8.5c2.5-2.5 13.5-2.5 16 0'],
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The dark rounded square that holds an icon on tiles and rows. */
export const IconBox = ({ name, bg = 'var(--ink)', fg = 'var(--paper)', size = 46 }: { name: IconName; bg?: string; fg?: string; size?: number }) => (
  <span aria-hidden className="grid shrink-0 place-items-center rounded-[14px]" style={{ width: size, height: size, background: bg, color: fg }}><Icon name={name} size={Math.round(size * 0.52)} /></span>
);

const STENCIL = ['M20 190 H380', 'M40 190 V110 H360 V190', 'M170 190 V120 Q200 80 230 120 V190', 'M180 190 V124 Q200 94 220 124 V190', 'M185 70 Q200 30 215 70', 'M200 30 V14', 'M196 14 H204', 'M170 110 V80 H230 V110', 'M160 110 H240', 'M60 110 V84 H110 V110', 'M60 84 Q85 56 110 84', 'M70 110 V96 Q85 80 100 96 V110', 'M290 110 V84 H340 V110', 'M290 84 Q315 56 340 84', 'M300 110 V96 Q315 80 330 96 V110', 'M40 110 V100 H52 V110', 'M348 110 V100 H360 V110', 'M20 190 V176 H380 V190', 'M120 190 V140 Q135 124 150 140 V190', 'M250 190 V140 Q265 124 280 140 V190', 'M60 132 H110', 'M290 132 H340', 'M10 50 Q30 20 50 50', 'M350 50 Q370 20 390 50'];

/** Faint haveli outline behind the hero text. Decoration only. A hotel photo replaces it when the manager has uploaded one. */
export function Hero({ photo }: { photo?: string | null }) {
  const mask = { WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)', maskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)' } as const;
  if (photo) {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-0 h-52 overflow-hidden" style={mask}>
        {/* eslint-disable-next-line @next/next/no-img-element -- own storage, hotel's own photo */}
        <img src={photo} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--hero-0) 45%, transparent), color-mix(in srgb, var(--hero-0) 92%, transparent))' }} />
      </div>
    );
  }
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-0 h-48 opacity-[0.16]" style={{ color: 'var(--on-hero)', ...mask }}>
      <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMin slice" className="block h-full w-full">
        {STENCIL.map((d) => <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
    </div>
  );
}

/** Hotel logo and name in a white pill; sits on the hero, so it stays readable on any brand colour. */
export function BrandPill({ name, logo }: { name: string; logo?: string | null }) {
  return (
    <span className="inline-flex max-w-[70%] items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold shadow-sm" style={{ background: 'rgba(255,255,255,.94)', color: '#4a3b32', fontFamily: "Marcellus, 'Iowan Old Style', Georgia, serif" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- own storage, tiny logo */}
      {logo && <img src={logo} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-lg object-cover" />}
      <span className="truncate text-sm">{name}</span>
    </span>
  );
}

/** "Powered by [Taprizz logo]" opens the Taprizz Instagram. */
export function PoweredPill({ href, label }: { href: string | null; label: string }) {
  const inner = (
    <>
      <span>{label.replace(/\s*Taprizz\s*$/i, '')}</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- local logo file */}
      <img src="/taprizz-logo.svg" alt="Taprizz" height={34} className="h-8 w-auto" />
    </>
  );
  const cls = 'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-xs font-medium shadow-sm';
  const style = { background: 'rgba(255,255,255,.94)', color: '#5b6270' } as const;
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={cls} style={style}>{inner}</a> : <span className={cls} style={style}>{inner}</span>;
}
