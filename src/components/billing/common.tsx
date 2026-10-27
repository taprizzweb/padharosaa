'use client';

import type { ReactNode } from 'react';
import { ApiFailure } from '@/lib/guest/client';
import { en, errorMessageKey } from '@/lib/i18n';

export const field = 'mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900';
export const small = 'min-h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-sm text-stone-900';
export const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[.08em] text-stone-500';
export const td = 'px-3 py-2.5 align-top';

export function Label({ text, children, hint }: { text: string; children: ReactNode; hint?: string }) {
  return <label className="block text-sm font-semibold">{text}{children}{hint && <span className="mt-1 block text-xs font-normal text-stone-500">{hint}</span>}</label>;
}

/** The sentence for a failed call: the server's own error key, never a code or a stack */
export function errText(e: unknown, fallback = 'That did not work. Please try again.'): string {
  if (e instanceof ApiFailure) return en[errorMessageKey(e.key)] ?? fallback;
  return fallback;
}

export type Flash = (ok: boolean, text: string) => void;
