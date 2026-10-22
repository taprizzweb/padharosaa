'use client';
import { btnSecondary } from '@/components/guest/ui';
import { MAX_GROUPS, MAX_OPTIONS, MAX_VARIANTS, SIZE_PRESETS, type Drafts, type GroupDraft } from '@/lib/dash/choices';
import { inputCls } from './api';

const small = 'mt-0 h-11 rounded-xl border border-stone-300 bg-white px-3 text-base font-normal';
const tiny = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 hover:bg-stone-100';

/** Sizes (Small / Large, Half / Full...) and options (sauce, extras...) for one dish. Everything is a draft until the dish is saved. */
export function ChoicesEditor({ value, onChange }: { value: Drafts; onChange: (d: Drafts) => void }) {
  const setVariant = (i: number, patch: Partial<Drafts['variants'][number]>) => onChange({ ...value, variants: value.variants.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
  const setGroup = (i: number, patch: Partial<GroupDraft>) => onChange({ ...value, groups: value.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });

  return (
    <div className="space-y-5">
      <section aria-labelledby="sizes-h" className="rounded-xl border border-stone-200 p-3">
        <h3 id="sizes-h" className="text-sm font-bold">Sizes (optional)</h3>
        <p className="text-sm text-stone-700">If this dish comes in sizes (Small, Medium, Large, or Half and Full), add them here with a price each. Guests tap the dish and pick one size.</p>
        {value.variants.length === 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {SIZE_PRESETS.map((p) => (
              <button key={p.label} type="button" className={btnSecondary} onClick={() => onChange({ ...value, variants: p.names.map((name) => ({ name, price: '', available: true })) })}>{p.label}</button>
            ))}
          </div>
        )}
        <ul className="mt-2 space-y-2">
          {value.variants.map((v, i) => (
            <li key={v.id ?? `n${i}`} className="flex flex-wrap items-center gap-2">
              <input aria-label={`Size ${i + 1} name`} placeholder="Name, e.g. Large" maxLength={30} value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} className={`${small} min-w-0 flex-1 basis-32`} />
              <input aria-label={`Size ${i + 1} price in rupees`} placeholder="Price ₹" inputMode="decimal" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} className={`${small} w-28`} />
              <label className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={v.available} onChange={(e) => setVariant(i, { available: e.target.checked })} aria-label={`Size ${i + 1} available`} /> Available</label>
              <button type="button" className={tiny} aria-label={`Remove size ${i + 1}`} onClick={() => onChange({ ...value, variants: value.variants.filter((_, k) => k !== i) })}>Remove</button>
            </li>
          ))}
        </ul>
        {value.variants.length > 0 && <p className="mt-1 text-sm text-stone-700">The dish shows &ldquo;from&rdquo; its cheapest size. The Price field above is not used while sizes exist.</p>}
        {value.variants.length < MAX_VARIANTS && <button type="button" className={`${btnSecondary} mt-2`} onClick={() => onChange({ ...value, variants: [...value.variants, { name: '', price: '', available: true }] })}>Add a size</button>}
      </section>

      <section aria-labelledby="opts-h" className="rounded-xl border border-stone-200 p-3">
        <h3 id="opts-h" className="text-sm font-bold">Options (optional)</h3>
        <p className="text-sm text-stone-700">Extra choices for this dish, for example &ldquo;Choose your sauce&rdquo; (pick 1, required) or &ldquo;Add extras&rdquo; (pick up to 3, with an extra price each).</p>
        <div className="mt-2 space-y-3">
          {value.groups.map((g, gi) => (
            <div key={g.id ?? `g${gi}`} role="group" aria-label={`Option group ${gi + 1}`} className="space-y-2 rounded-lg bg-stone-50 p-3">
              <input aria-label={`Group ${gi + 1} title`} placeholder="Title, e.g. Choose your sauce" maxLength={40} value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} className={`${inputCls} mt-0`} />
              <div className="flex flex-wrap items-center gap-x-4">
                <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={g.required} onChange={(e) => setGroup(gi, { required: e.target.checked })} aria-label={`Group ${gi + 1} is required`} /> Guest must choose</label>
                <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">Can choose up to
                  <input aria-label={`Group ${gi + 1} maximum choices`} inputMode="numeric" value={g.max} onChange={(e) => setGroup(gi, { max: e.target.value })} className={`${small} w-16 text-center`} />
                </label>
              </div>
              <ul className="space-y-2">
                {g.options.map((o, oi) => (
                  <li key={o.id ?? `o${oi}`} className="flex flex-wrap items-center gap-2">
                    <input aria-label={`Group ${gi + 1} choice ${oi + 1} name`} placeholder="Choice, e.g. Cheese dip" maxLength={40} value={o.name} onChange={(e) => setGroup(gi, { options: g.options.map((x, k) => (k === oi ? { ...x, name: e.target.value } : x)) })} className={`${small} min-w-0 flex-1 basis-32`} />
                    <input aria-label={`Group ${gi + 1} choice ${oi + 1} extra price in rupees`} placeholder="Extra ₹" inputMode="decimal" value={o.price} onChange={(e) => setGroup(gi, { options: g.options.map((x, k) => (k === oi ? { ...x, price: e.target.value } : x)) })} className={`${small} w-24`} />
                    <button type="button" className={tiny} aria-label={`Remove choice ${oi + 1} from group ${gi + 1}`} onClick={() => setGroup(gi, { options: g.options.filter((_, k) => k !== oi) })}>Remove</button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {g.options.length < MAX_OPTIONS && <button type="button" className={btnSecondary} onClick={() => setGroup(gi, { options: [...g.options, { name: '', price: '' }] })}>Add a choice</button>}
                <button type="button" className={btnSecondary} onClick={() => onChange({ ...value, groups: value.groups.filter((_, k) => k !== gi) })}>Remove this group</button>
              </div>
            </div>
          ))}
        </div>
        {value.groups.length < MAX_GROUPS && (
          <button type="button" className={`${btnSecondary} mt-2`} onClick={() => onChange({ ...value, groups: [...value.groups, { name: '', required: false, max: '1', options: [{ name: '', price: '' }] }] })}>Add an option group</button>
        )}
      </section>
    </div>
  );
}
