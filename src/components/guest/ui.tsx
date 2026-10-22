'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Diet } from '@/lib/guest/types';
import type { Translator } from '@/lib/i18n';

type IconProps = { className?: string };
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export const IconCart = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M6 6h15l-1.5 9h-12z" /><path d="M6 6 5 3H2" /><circle cx="9" cy="20" r="1.2" /><circle cx="18" cy="20" r="1.2" /></svg>
);
export const IconBell = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>
);
export const IconReceipt = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
);
export const IconList = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
);
export const IconSearch = ({ className }: IconProps) => (
  <svg {...base} className={className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconPlus = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMinus = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M5 12h14" /></svg>
);
export const IconClose = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const IconCheck = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);

const DIET_COLOR: Record<Diet, string> = { veg: '#15803d', jain: '#15803d', nonveg: '#b91c1c', egg: '#a16207' };

/** Indian packaged-food convention: coloured square outline with a dot (triangle for non-veg). */
export function DietMark({ diet, t }: { diet: Diet; t: Translator }) {
  const color = DIET_COLOR[diet];
  return (
    <span className="inline-flex items-center gap-1">
      <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label={t(`diet.${diet}` as 'diet.veg')}>
        <rect x="1" y="1" width="14" height="14" rx="2" fill="#fff" stroke={color} strokeWidth="1.5" />
        {diet === 'nonveg' ? <path d="M8 4.2 12 11.5H4z" fill={color} /> : <circle cx="8" cy="8" r="3.2" fill={color} />}
      </svg>
      {diet === 'jain' && <span className="text-xs font-semibold text-green-800">{t('diet.jain')}</span>}
    </span>
  );
}

export function SpiceDots({ level, t }: { level: number; t: Translator }) {
  if (level <= 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={t(`spice.${level}` as 'spice.1')}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={`h-2 w-2 rounded-full ${n <= level ? 'bg-red-600' : 'bg-stone-300'}`} />
      ))}
    </span>
  );
}

/** Bottom sheet on the browser's native <dialog>: focus trap, Esc to close and focus restore come for free. */
export function Sheet({ open, onClose, title, closeLabel, children }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-panel mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-xl md:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100" aria-label={closeLabel}>
            <IconClose />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{open ? children : null}</div>
      </div>
    </dialog>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">
      {children}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      {children}
    </p>
  );
}

export const btnPrimary =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60';
export const btnSecondary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-900 hover:bg-stone-100';
