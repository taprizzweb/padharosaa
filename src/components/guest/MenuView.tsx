'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { formatPaise } from '@/lib/money';
import { fromPrice, isCustomisable } from '@/lib/guest/options';
import { FILTERS, barItemIds, categoryHasMatch, isBarCategory, markFor, passesFilters, toggleFilter, type Filter } from '@/lib/guest/filters';
import type { MenuCategory, MenuItem } from '@/lib/guest/types';
import type { Translator } from '@/lib/i18n';
import type { TrackIds } from '@/lib/guest/analytics';
import type { MenuEvent } from '@/lib/schemas/guest';
import { DietMark, IconMinus, IconPlus, IconSearch, Sheet, SpiceDots } from './ui';

interface Ordering {
  t: Translator; canOrder: boolean; imageBase: string;
  /** dishes of a "Bar - ..." category: they carry no veg or non-veg mark */
  barIds: ReadonlySet<string>;
  qtyOf: (id: string) => number; onAdd: (id: string) => void; onSet: (id: string, qty: number) => void;
  /** a dish with sizes or options: open the choose sheet instead of adding straight away */
  onCustomise: (item: MenuItem) => void;
}

/** "₹250", or "from ₹120" for a dish that comes in sizes. */
const priceText = (item: MenuItem, t: Translator): string => ((item.variants?.length ?? 0) > 0 ? t('item.from', { price: formatPaise(fromPrice(item)) }) : formatPaise(item.price_paise));

/** Photo with a fixed aspect box (no layout shift) and a tinted letter tile behind it, so a slow or missing image never shows a broken icon. */
function Photo({ item, imageBase, ratio, sizes }: { item: MenuItem; imageBase: string; ratio: string; sizes?: string }) {
  const soldOut = !item.is_available;
  return (
    <div className={`relative w-full overflow-hidden bg-accent/10 ${ratio}`}>
      <span aria-hidden className="absolute inset-0 flex items-center justify-center font-serif text-5xl font-bold text-accent/40">{item.name_en.trim().charAt(0).toUpperCase()}</span>
      {item.image_path && (
        // eslint-disable-next-line @next/next/no-img-element -- menu photos are shrunk on upload and come from our own storage
        <img src={`${imageBase}${item.image_path}`} alt="" sizes={sizes} loading="lazy" decoding="async" className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 motion-reduce:transition-none ${soldOut ? 'grayscale' : ''}`} />
      )}
    </div>
  );
}

function Badges({ item, t }: { item: MenuItem; t: Translator }) {
  if (!item.is_bestseller && !item.is_chef_pick) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {item.is_bestseller && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">{t('badge.bestseller')}</span>}
      {item.is_chef_pick && <span className="rounded-md bg-stone-900 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">{t('badge.chefPick')}</span>}
    </span>
  );
}

/** Add button / quantity stepper. Same accessible names everywhere it appears. */
function AddControl({ item, o, large = false }: { item: MenuItem; o: Ordering; large?: boolean }) {
  const { t, qtyOf, onAdd, onSet } = o;
  const qty = qtyOf(item.id);
  const name = item.name_en;
  if (!item.is_available) return <span className="flex min-h-11 items-center text-sm font-bold text-stone-600">{t('item.soldOut')}</span>;
  if (!o.canOrder) return null;
  if (isCustomisable(item)) {
    // a dish with sizes / options always opens its choose sheet; the badge shows how many are already in the cart
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); o.onCustomise(item); }} aria-label={t('item.addNamed', { name })} className={`flex min-h-11 items-center justify-center gap-1 rounded-xl bg-accent px-4 text-sm font-bold text-white shadow-sm active:scale-95 motion-reduce:active:scale-100 ${large ? 'w-full min-h-12 text-base' : ''}`}>
        <IconPlus /> {t('item.add')}{qty > 0 && <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-xs font-extrabold text-stone-900" aria-label={t('item.inCart', { n: String(qty) })}>{qty}</span>}
      </button>
    );
  }
  if (qty === 0) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onAdd(item.id); }} aria-label={t('item.addNamed', { name })} className={`flex min-h-11 items-center justify-center gap-1 rounded-xl bg-accent px-4 text-sm font-bold text-white shadow-sm active:scale-95 motion-reduce:active:scale-100 ${large ? 'w-full min-h-12 text-base' : ''}`}>
        <IconPlus /> {t('item.add')}
      </button>
    );
  }
  return (
    <div className={`flex items-center justify-between rounded-xl bg-accent text-white shadow-sm ${large ? 'w-full' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => onSet(item.id, qty - 1)} aria-label={t('item.decrease', { name })} className="flex h-11 w-11 items-center justify-center"><IconMinus /></button>
      <span className="min-w-6 text-center text-base font-bold" aria-live="polite">{qty}</span>
      <button type="button" onClick={() => onSet(item.id, qty + 1)} aria-label={t('item.increase', { name })} className="flex h-11 w-11 items-center justify-center disabled:opacity-50" disabled={qty >= 10}><IconPlus /></button>
    </div>
  );
}

const ItemCard = memo(function ItemCard({ item, o, onOpen }: { item: MenuItem; o: Ordering; onOpen: (i: MenuItem) => void }) {
  const { t } = o;
  const soldOut = !item.is_available;
  const hasPhoto = !!item.image_path;
  const mark = markFor(item, o.barIds);
  const info = (
    <>
      <h3 className={`font-serif text-[17px] font-semibold leading-snug ${soldOut ? 'text-stone-600' : 'text-stone-900'}`}>{mark && <><DietMark diet={mark} t={t} />{' '}</>}{item.name_en}</h3>
      {item.description_en && <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-stone-600">{item.description_en}</p>}
    </>
  );
  const foot = (
    <div className="mt-3 flex items-center justify-between gap-2">
      <span className="text-lg font-bold tabular-nums">{priceText(item, t)}</span>
      <AddControl item={item} o={o} />
    </div>
  );
  // Dishes with a photo become image-led cards in a grid; dishes without one stay as compact full-width rows (no empty picture boxes).
  if (!hasPhoto) {
    return (
      <li className={`col-span-full flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm ${soldOut ? 'bg-stone-100' : ''}`}>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2"><Badges item={item} t={t} /></div>
          {info}
          <div className="mt-2"><SpiceDots level={item.spice} t={t} /></div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-lg font-bold tabular-nums">{priceText(item, t)}</span>
          <AddControl item={item} o={o} />
        </div>
      </li>
    );
  }
  return (
    <li className={`group flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm ${soldOut ? 'bg-stone-100' : ''}`}>
      <div className="relative">
        {soldOut ? (
          <Photo item={item} imageBase={o.imageBase} ratio="aspect-[4/3]" />
        ) : (
          <button type="button" onClick={() => onOpen(item)} aria-label={t('item.view', { name: item.name_en })} className="block w-full overflow-hidden text-left">
            <Photo item={item} imageBase={o.imageBase} ratio="aspect-[4/3]" />
          </button>
        )}
        {item.is_bestseller && <span className="pointer-events-none absolute bottom-2 left-2"><Badges item={{ ...item, is_chef_pick: false }} t={t} /></span>}
        {soldOut && <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/60 text-sm font-bold text-stone-900">{t('item.soldOut')}</span>}
      </div>
      <div className="flex flex-1 flex-col p-3">
        {info}
        <div className="mt-auto">{foot}</div>
      </div>
    </li>
  );
});

function FavouriteCard({ item, o, onOpen }: { item: MenuItem; o: Ordering; onOpen: (i: MenuItem) => void }) {
  const { t } = o;
  const soldOut = !item.is_available;
  const body = (
    <>
      <Photo item={item} imageBase={o.imageBase} ratio="aspect-[5/4]" />
      <span className="block p-3">
        <span className="block font-serif text-base font-semibold leading-snug text-stone-900">{markFor(item, o.barIds) && <><DietMark diet={markFor(item, o.barIds)!} t={t} />{' '}</>}{item.name_en}</span>
        <span className="mt-1 block text-base font-bold tabular-nums text-stone-900">{priceText(item, t)}</span>
      </span>
    </>
  );
  return (
    <li className="w-44 shrink-0 snap-start overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm sm:w-56">
      {soldOut ? <div aria-label={`${item.name_en}, ${t('item.soldOut')}`}>{body}</div> : <button type="button" onClick={() => onOpen(item)} aria-label={t('item.view', { name: item.name_en })} className="block w-full text-left">{body}</button>}
    </li>
  );
}

function DetailsSheet({ item, o, onClose }: { item: MenuItem | null; o: Ordering; onClose: () => void }) {
  const { t } = o;
  // keep showing the last dish while the sheet animates out
  const last = useRef<MenuItem | null>(null);
  if (item) last.current = item;
  const it = item ?? last.current;
  return (
    <Sheet open={!!item} onClose={onClose} title={it?.name_en ?? ''} closeLabel={t('item.close')}>
      {it && (
        <div className="-mx-5 -mt-4">
          {it.image_path && <Photo item={it} imageBase={o.imageBase} ratio="aspect-[4/3]" />}
          <div className="space-y-3 px-5 pb-1 pt-4">
            <div className="flex flex-wrap items-center gap-2">{markFor(it, o.barIds) && <DietMark diet={markFor(it, o.barIds)!} t={t} />}<Badges item={it} t={t} /><SpiceDots level={it.spice} t={t} /></div>
            {it.description_en && <p className="text-[15px] leading-relaxed text-stone-800">{it.description_en}</p>}
            <p className="font-serif text-2xl font-bold tabular-nums">{priceText(it, t)}</p>
            <AddControl item={it} o={o} large />
          </div>
        </div>
      )}
    </Sheet>
  );
}

const initial = (s: string) => s.trim().charAt(0).toUpperCase();

export function MenuView({ categories, t, canOrder, imageBase, qtyOf, onAdd, onSet, onCustomise, onTrack, initialCats = [], initialDiet = [] }: Omit<Ordering, 'barIds'> & { categories: MenuCategory[]; onTrack?: (e: MenuEvent, ids?: TrackIds) => void; initialCats?: string[]; initialDiet?: Filter[] }) {
  const barIds = useMemo(() => barItemIds(categories), [categories]);
  const o: Ordering = { t, canOrder, imageBase, barIds, qtyOf, onAdd, onSet, onCustomise };
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Set<Filter>>(new Set(initialDiet));
  // category chips: pick several; the menu then shows only those categories
  const [catSel, setCatSel] = useState<Set<string>>(new Set(initialCats.filter((id) => categories.some((c) => c.id === id))));
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetailState] = useState<MenuItem | null>(null);
  const setDetail = (i: MenuItem | null) => {
    setDetailState(i);
    if (i) onTrack?.('item_viewed', { item_id: i.id });
  };
  const barRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categories
      .filter((c) => catSel.size === 0 || catSel.has(c.id))
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => {
          if (!passesFilters(i, isBarCategory(c.name_en), filters)) return false;
          if (!q) return true;
          return [i.name_en, i.description_en].some((s) => s?.toLowerCase().includes(q));
        }),
      }))
      .filter((c) => c.items.length > 0);
  }, [categories, query, filters, catSel]);

  const favourites = useMemo(
    () => categories.flatMap((c) => c.items).filter((i) => i.is_available && (i.is_bestseller || i.is_chef_pick)).slice(0, 10),
    [categories],
  );
  const browsing = query.trim() === '' && filters.size === 0 && catSel.size === 0;

  // Highlight the category currently under the sticky bar.
  useEffect(() => {
    const els = shown.map((c) => document.getElementById(`cat-${c.id}`)).filter((e): e is HTMLElement => !!e);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id.replace('cat-', ''));
      },
      { rootMargin: '-96px 0px -65% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [shown]);

  // Keep the active category visible in the horizontal bar.
  useEffect(() => {
    if (!active) return;
    barRef.current?.querySelector<HTMLElement>(`[data-cat='${active}']`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active]);

  const toggleCat = (id: string) =>
    setCatSel((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggle = (f: Filter) => setFilters((cur) => toggleFilter(cur, f));

  // a search counts once the guest pauses typing, not on every keystroke
  useEffect(() => {
    if (query.trim().length < 2) return;
    const h = setTimeout(() => onTrack?.('search'), 1200);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const jump = (id: string) => {
    onTrack?.('category_viewed', { category_id: id });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const filterBtn = (on: boolean) => `inline-flex min-h-11 shrink-0 items-center rounded-lg border px-3.5 text-sm font-semibold ${on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800'}`;
  const thumbOf = (c: MenuCategory) => c.items.find((i) => i.image_path)?.image_path ?? null;

  return (
    <>
      <div id="menu" className="mx-auto max-w-5xl scroll-mt-2 px-4 pb-3 pt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block sm:max-w-sm sm:flex-1">
            <span className="sr-only">{t('menu.search')}</span>
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('menu.searchPlaceholder')}
              className="h-12 w-full rounded-xl border border-stone-300 bg-white pl-11 pr-3 text-base shadow-sm"
              maxLength={60}
              enterKeyHint="search"
              autoComplete="off"
            />
          </label>
          <div role="group" aria-label={t('menu.filters')} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filters.has(f)} onClick={() => toggle(f)} className={filterBtn(filters.has(f))}>
                {t(`menu.filter.${f}` as 'menu.filter.veg')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {categories.length > 1 && (
        <div className="mx-auto max-w-5xl px-4 pb-2">
          <p id="cat-chips-h" className="mb-1 text-xs font-bold uppercase tracking-wide text-stone-700">{t('menu.catChips')}</p>
          <div role="group" aria-labelledby="cat-chips-h" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {categories.filter((c) => categoryHasMatch(c, filters)).map((c) => (
              <button key={c.id} type="button" aria-pressed={catSel.has(c.id)} onClick={() => toggleCat(c.id)} className={filterBtn(catSel.has(c.id))}>{catSel.has(c.id) ? '✓ ' : ''}{c.name_en}</button>
            ))}
          </div>
        </div>
      )}

      {browsing && favourites.length > 0 && (
        <section aria-labelledby="fav-h" className="mx-auto max-w-5xl pb-2 pt-3">
          <h2 id="fav-h" className="px-4 font-serif text-xl font-bold">{t('menu.favourites')}</h2>
          <ul className="no-scrollbar mt-3 flex snap-x scroll-pl-4 gap-3 overflow-x-auto px-4 pb-2">
            {favourites.map((i) => <FavouriteCard key={i.id} item={i} o={o} onOpen={setDetail} />)}
          </ul>
        </section>
      )}

      {/* Only this row sticks while scrolling. */}
      <div className="sticky top-0 z-20 border-y border-stone-200 bg-stone-50/95 backdrop-blur-sm">
        <nav aria-label={t('menu.categories')} ref={barRef} className="no-scrollbar mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 py-2">
          {shown.map((c) => {
            const on = active === c.id;
            const th = thumbOf(c);
            return (
              <button key={c.id} type="button" data-cat={c.id} onClick={() => jump(c.id)} aria-current={on ? 'true' : undefined} className="group flex min-h-16 min-w-16 shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-1">
                <span aria-hidden className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-accent/10 font-serif text-base font-bold text-accent ring-2 ring-offset-2 ring-offset-stone-50 transition-shadow ${on ? 'ring-accent' : 'ring-transparent'}`}>
                  {initial(c.name_en)}
                  {th && (
                    // eslint-disable-next-line @next/next/no-img-element -- small thumbnail from our own storage
                    <img src={`${imageBase}${th}`} alt="" width={40} height={40} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                </span>
                <span className={`max-w-24 truncate text-xs ${on ? 'font-bold text-stone-900' : 'font-medium text-stone-700'}`}>{c.name_en}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mx-auto max-w-5xl px-4">
        {categories.length === 0 ? (
          <p className="py-16 text-center text-stone-600">{t('menu.empty')}</p>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-stone-600">{t('menu.noResults')}</p>
            <button type="button" onClick={() => { setQuery(''); setFilters(new Set()); setCatSel(new Set()); }} className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold">
              {t('menu.clearFilters')}
            </button>
          </div>
        ) : (
          shown.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`cat-h-${c.id}`} className="scroll-mt-24 pt-7">
              <h2 id={`cat-h-${c.id}`} className="mb-3 font-serif text-2xl font-bold">{c.name_en}</h2>
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
                {c.items.map((i) => <ItemCard key={i.id} item={i} o={o} onOpen={setDetail} />)}
              </ul>
            </section>
          ))
        )}
      </div>
      <DetailsSheet item={detail} o={o} onClose={() => setDetail(null)} />
    </>
  );
}
