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
