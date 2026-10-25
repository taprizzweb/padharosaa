'use client';
import { useState } from 'react';
import { formatPaise } from '@/lib/money';
import { lineLabel, unitPrice } from '@/lib/guest/options';
import { markFor } from '@/lib/guest/filters';
import type { MenuItem } from '@/lib/guest/types';
import type { Translator } from '@/lib/i18n';
import type { Cart } from './hooks';
import { Alert, DietMark, IconMinus, IconPlus, Notice, Sheet, btnPrimary } from './ui';

export function CartSheet({
  open, onClose, t, cart, items, barIds, placing, error, adjusted, onPlace, handoverUi = null,
}: {
  open: boolean; onClose: () => void; t: Translator; cart: Cart; items: Map<string, MenuItem>; barIds: ReadonlySet<string>;
  placing: boolean; error: string | null; adjusted: boolean; onPlace: () => void;
  /** hotel guests only: Room delivery or Takeaway (the desk sets the Takeaway time) */
  handoverUi?: { roomDining: boolean; mode: 'deliver' | 'takeaway'; setMode: (m: 'deliver' | 'takeaway') => void } | null;
}) {
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  return (
    <Sheet open={open} onClose={onClose} title={t('cart.title')} closeLabel={t('cart.close')}>
      {cart.lines.length === 0 ? (
        <p className="py-8 text-center text-stone-600">{t('cart.empty')}</p>
      ) : (
        <div className="space-y-5">
          {adjusted && <Notice>{t('cart.priceChanged')}</Notice>}
          <ul className="divide-y divide-stone-200">
            {cart.lines.map((l) => {
              const item = items.get(l.item_id);
              if (!item) return null;
              const name = item.name_en;
              const label = lineLabel(item, l.variant_id, l.option_ids ?? []);
              const unit = unitPrice(item, l.variant_id, l.option_ids ?? []) ?? item.price_paise;
              const noteOpen = openNotes.has(l.id) || !!l.note;
              return (
                <li key={l.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug">{markFor(item, barIds) && <><DietMark diet={markFor(item, barIds)!} t={t} />{' '}</>}{name}</p>
                      {label && <p className="text-sm font-medium text-stone-800">{label}</p>}
                      <p className="text-sm text-stone-600">{formatPaise(unit)} × {l.qty} = <span className="font-semibold text-stone-900">{formatPaise(unit * l.qty)}</span></p>
                    </div>
                    <div className="flex shrink-0 items-center rounded-xl border border-stone-300">
                      <button type="button" onClick={() => cart.setQty(l.id, l.qty - 1)} aria-label={l.qty === 1 ? t('cart.remove', { name }) : t('item.decrease', { name })} className="flex h-11 w-11 items-center justify-center">
                        <IconMinus />
                      </button>
                      <span className="min-w-6 text-center font-bold" aria-live="polite">{l.qty}</span>
                      <button type="button" onClick={() => cart.setQty(l.id, l.qty + 1)} disabled={l.qty >= 10} aria-label={t('item.increase', { name })} className="flex h-11 w-11 items-center justify-center disabled:opacity-40">
                        <IconPlus />
                      </button>
                    </div>
                  </div>
                  {noteOpen ? (
                    <label className="mt-2 block text-sm font-medium text-stone-800">
                      {t('cart.itemNote')}
                      <input
                        type="text"
                        value={l.note ?? ''}
                        maxLength={100}
                        onChange={(e) => cart.setLineNote(l.id, e.target.value)}
                        placeholder={t('cart.itemNoteHint')}
                        className="mt-1 h-11 w-full rounded-xl border border-stone-300 px-3 text-base font-normal"
                      />
                    </label>
                  ) : (
                    <button type="button" onClick={() => setOpenNotes((s) => new Set(s).add(l.id))} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline underline-offset-2">
                      + {t('cart.itemNote')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {handoverUi && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold text-stone-900">{t('cart.handover.title')}</legend>
              {!handoverUi.roomDining && <p role="note" className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-950">{t('cart.handover.noRoom')}</p>}
              <div className="grid grid-cols-2 gap-2">
                {handoverUi.roomDining && (
                  <button type="button" aria-pressed={handoverUi.mode === 'deliver'} onClick={() => handoverUi.setMode('deliver')}
                    className={`min-h-16 rounded-xl border-2 px-3 py-2 text-left font-bold ${handoverUi.mode === 'deliver' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-400 bg-white text-stone-900'}`}>
                    {t('cart.handover.deliver')}<span className="block text-xs font-medium">{t('cart.handover.deliverSub')}</span>
                  </button>
                )}
                <button type="button" aria-pressed={!handoverUi.roomDining || handoverUi.mode === 'takeaway'} onClick={() => handoverUi.setMode('takeaway')}
                  className={`min-h-16 rounded-xl border-2 px-3 py-2 text-left font-bold ${!handoverUi.roomDining || handoverUi.mode === 'takeaway' ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-400 bg-white text-stone-900'} ${handoverUi.roomDining ? '' : 'col-span-2'}`}>
                  {t('cart.handover.takeaway')}<span className="block text-xs font-medium">{t('cart.handover.takeawaySub')}</span>
                </button>
              </div>
            </fieldset>
          )}

          <label className="block text-sm font-medium text-stone-800">
            {t('cart.kitchenNote')}
            <textarea
              value={cart.note}
              maxLength={200}
              rows={2}
              onChange={(e) => cart.setNote(e.target.value)}
              placeholder={t('cart.kitchenNoteHint')}
              className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-base font-normal"
            />
          </label>

          <div>
            <p className="text-xs font-semibold text-stone-700">{t('cart.exGst')}</p>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold">{t('cart.total')}</span>
              <span className="text-2xl font-extrabold">{formatPaise(cart.totalPaise)}</span>
            </div>
            <p className="mt-1 text-xs text-stone-600">{t('cart.totalHint')}</p>
          </div>

          {error && <Alert>{error}</Alert>}

          <button type="button" onClick={onPlace} disabled={placing} className={`${btnPrimary} w-full min-h-14 text-lg`}>
            {placing ? t('cart.placing') : t('cart.place')}
          </button>
        </div>
      )}
    </Sheet>
  );
}
