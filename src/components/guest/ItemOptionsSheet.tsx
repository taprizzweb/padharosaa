'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPaise } from '@/lib/money';
import { selectionProblem, unitPrice } from '@/lib/guest/options';
import type { MenuItem } from '@/lib/guest/types';
import type { Translator } from '@/lib/i18n';
import { IconMinus, IconPlus, Sheet, btnPrimary } from './ui';

/**
 * The dish's "choose" sheet: pick a size (Small / Large, Half / Full...) and any options, see the live price, add to cart.
 * Nothing is pre-selected, so a size or a required choice is always a conscious tap. The server prices the order itself.
 */
export function ItemOptionsSheet({ item, t, onClose, onAdd }: {
  item: MenuItem | null; t: Translator; onClose: () => void;
  onAdd: (item: MenuItem, variantId: string | undefined, optionIds: string[], qty: number) => void;
}) {
  // keep showing the last dish while the sheet animates out
  const last = useRef<MenuItem | null>(null);
  if (item) last.current = item;
  const it = item ?? last.current;

  const [variant, setVariant] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);
  const [tried, setTried] = useState(false);

  // a fresh choice every time the sheet opens for a dish
  useEffect(() => {
    if (item) {
      setVariant(undefined);
      setPicked(new Set());
      setQty(1);
      setTried(false);
    }
  }, [item]);

  const optionIds = useMemo(() => [...picked], [picked]);
  const problem = it ? selectionProblem(it, variant, optionIds) : null;
  const unit = it ? unitPrice(it, variant, optionIds) : null;

  if (!it) return <Sheet open={false} onClose={onClose} title="" closeLabel={t('item.close')}>{null}</Sheet>;

  const toggle = (groupId: string, optionId: string, max: number) => {
    setPicked((cur) => {
      const next = new Set(cur);
      const group = it.option_groups!.find((g) => g.id === groupId)!;
      if (next.has(optionId)) {
        next.delete(optionId);
        return next;
      }
      if (max === 1) group.options.forEach((o) => next.delete(o.id)); // one choice: tapping another replaces it
      else if (group.options.filter((o) => next.has(o.id)).length >= max) return cur; // at the limit: the others are disabled
      next.add(optionId);
      return next;
    });
  };

  const hint = (g: NonNullable<MenuItem['option_groups']>[number]) =>
    g.required ? (g.max_select === 1 ? t('choose.requiredOne') : t('choose.requiredUpTo', { n: String(g.max_select) })) : t('choose.optionalUpTo', { n: String(g.max_select) });
  const problemText = !problem ? '' : problem.problem === 'size' ? t('choose.needSize') : problem.problem === 'required' ? t('choose.needGroup', { name: problem.group ?? '' }) : t('choose.invalid');

  return (
    <Sheet open={!!item} onClose={onClose} title={it.name_en} closeLabel={t('item.close')}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (problem) {
            setTried(true);
            return;
          }
          onAdd(it, variant, optionIds, qty);
        }}
      >
        {(it.variants?.length ?? 0) > 0 && (
          <fieldset>
            <legend className="mb-2 flex w-full items-baseline justify-between text-base font-bold">
              {t('choose.size')} <span className="text-xs font-semibold text-stone-600">{t('choose.requiredOne')}</span>
            </legend>
            <div className="space-y-2">
              {it.variants!.map((v) => (
                <label key={v.id} className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 ${variant === v.id ? 'border-accent bg-accent/10' : 'border-stone-300 bg-white'} ${v.is_available ? '' : 'cursor-not-allowed opacity-50'}`}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name="size" value={v.id} checked={variant === v.id} disabled={!v.is_available} onChange={() => setVariant(v.id)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
                    <span className="font-semibold">{v.name}</span>
                  </span>
                  <span className="font-bold tabular-nums">{v.is_available ? formatPaise(v.price_paise) : t('item.soldOut')}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {(it.option_groups ?? []).map((g) => {
          const count = g.options.filter((o) => picked.has(o.id)).length;
          return (
            <fieldset key={g.id}>
              <legend className="mb-2 flex w-full items-baseline justify-between gap-2 text-base font-bold">
                <span>{g.name}</span> <span className="text-xs font-semibold text-stone-600">{hint(g)}</span>
              </legend>
              <div className="space-y-2">
                {g.options.map((o) => {
                  const on = picked.has(o.id);
                  const blocked = !on && g.max_select > 1 && count >= g.max_select;
                  return (
                    <label key={o.id} className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 ${on ? 'border-accent bg-accent/10' : 'border-stone-300 bg-white'} ${blocked ? 'cursor-not-allowed opacity-50' : ''}`}>
                      <span className="flex items-center gap-3">
                        <input type={g.max_select === 1 ? 'radio' : 'checkbox'} name={`g-${g.id}`} checked={on} disabled={blocked} onChange={() => toggle(g.id, o.id, g.max_select)} onClick={() => { if (g.max_select === 1 && on && !g.required) toggle(g.id, o.id, 1); }} className="h-5 w-5 accent-[rgb(var(--accent))]" />
                        <span className="font-semibold">{o.name}</span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-stone-700">{o.price_delta_paise > 0 ? `+ ${formatPaise(o.price_delta_paise)}` : ''}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <div aria-live="polite" className="min-h-5 text-sm font-semibold text-red-800">{tried && problem ? problemText : ''}</div>

        <div className="flex items-center gap-3">
          <div className="flex shrink-0 items-center rounded-xl border border-stone-300">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label={t('item.decrease', { name: it.name_en })} className="flex h-12 w-12 items-center justify-center disabled:opacity-40"><IconMinus /></button>
            <span className="min-w-8 text-center text-lg font-bold" aria-live="polite">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(10, q + 1))} disabled={qty >= 10} aria-label={t('item.increase', { name: it.name_en })} className="flex h-12 w-12 items-center justify-center disabled:opacity-40"><IconPlus /></button>
          </div>
          <button type="submit" aria-disabled={!!problem} className={`${btnPrimary} min-h-12 flex-1 ${problem ? 'opacity-60' : ''}`}>
            {unit !== null ? t('choose.addTotal', { amount: formatPaise(unit * qty) }) : t('choose.add')}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
