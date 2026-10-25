'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * One look for every staff screen (desk, owner console, settings): hairline borders, a single indigo accent, small uppercase labels.
 * Plain class strings and tiny components, so a screen cannot drift away from the others.
 */
export const ns = {
  page: 'mx-auto min-h-dvh bg-stone-50 px-4 pb-24 pt-4 text-stone-900',
  card: 'rounded-xl border border-stone-200 bg-white p-5',
  label: 'text-[11px] font-semibold uppercase tracking-[.16em] text-stone-500',
  title: 'text-2xl font-semibold tracking-tight',
  primary: 'inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-900 px-4 text-sm font-semibold text-white disabled:opacity-50',
  secondary: 'inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-900 disabled:opacity-50',
  danger: 'inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold text-red-800 disabled:opacity-50',
  input: 'mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900',
  chip: 'rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700',
} as const;

export function Card({ title, hint, children, id }: { title?: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={`mt-4 ${ns.card}`}>
      {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
      {hint && <p className="mt-1 text-sm text-stone-600">{hint}</p>}
      <div className={title || hint ? 'mt-3' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = 'plain' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'plain' | 'warn' | 'good' }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4" data-testid="stat">
      <p className={ns.label}>{label}</p>
      <p className={`mt-1 text-3xl font-semibold tracking-tight ${tone === 'warn' ? 'text-red-800' : tone === 'good' ? 'text-emerald-800' : 'text-stone-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-sm text-stone-600">{sub}</p>}
    </div>
  );
}

/** Light or dark for the staff screens. It is remembered on this device and starts from the phone's own setting. */
export function useStaffTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem('staff-theme'); } catch { /* private mode */ }
    setDark(stored ? stored === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('ns-dark', dark);
    return () => document.documentElement.classList.remove('ns-dark');
  }, [dark]);
  return [dark, () => setDark((d) => { const n = !d; try { localStorage.setItem('staff-theme', n ? 'dark' : 'light'); } catch { /* private mode */ } return n; })];
}

export function ThemeToggle() {
  const [dark, toggle] = useStaffTheme();
  return (
    <button type="button" onClick={toggle} aria-pressed={dark} aria-label="Dark mode" className={`${ns.secondary} !px-3`}>
      <span aria-hidden>{dark ? '☀' : '☾'}</span><span className="ml-1.5">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
