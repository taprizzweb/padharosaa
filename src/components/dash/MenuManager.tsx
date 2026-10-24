'use client';
import { createBrowserClient } from '@supabase/ssr';
import { useMemo, useRef, useState } from 'react';
import { Alert, IconPlus, Notice, Sheet, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { formatPaise, parseRupeesToPaise } from '@/lib/money';
import { SAMPLE_CSV, menuToCsv, parseMenuCsv, type ParsedMenuCsv } from '@/lib/dash/csv';
import { choicesPayload, draftsFromItem, type ChoicesPayload, type Drafts } from '@/lib/dash/choices';
import { compressToWebp } from '@/lib/dash/image';
import { ChoicesEditor } from './ChoicesEditor';
import { dashPost, errText, inputCls, useDashData } from './api';

type Diet = 'veg' | 'nonveg' | 'egg' | 'jain';
interface Item { id: string; name: string; description: string | null; price_paise: number; diet: Diet; spice: number; image_path: string | null; is_available: boolean; is_bestseller: boolean; is_chef_pick: boolean; variants?: { id: string; name: string; price_paise: number; is_available: boolean }[]; groups?: { id: string; name: string; required: boolean; max_select: number; options: { id: string; name: string; price_delta_paise: number }[] }[] }
interface Category { id: string; name: string; active: boolean; items: Item[] }
interface MenuData { categories: Category[] }

const DIET_LABEL: Record<Diet, string> = { veg: 'Veg', nonveg: 'Non-veg', egg: 'Egg', jain: 'Jain' };
const smallBtn = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50';

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}
const rupees = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

export function MenuManager({ restaurantId, supabase, imageBase }: { restaurantId: string; supabase: { url: string; anonKey: string }; imageBase: string }) {
  const { data, error, reload, setData } = useDashData<MenuData>('menu');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [itemDlg, setItemDlg] = useState<{ item: Item | null; categoryId: string } | null>(null);
  const [catDlg, setCatDlg] = useState<{ cat: Category | null } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: () => Promise<void> } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priceDlg, setPriceDlg] = useState(false);
  const [csvDlg, setCsvDlg] = useState(false);
  const drag = useRef<{ cat: string; id: string } | null>(null);

  const cats = data?.categories ?? [];
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await reload();
      return true;
    } catch (e) {
      setErr(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reorderItems = (cat: Category, from: number, to: number) => {
    const ids = move(cat.items, from, to).map((i) => i.id);
    if (ids.join() === cat.items.map((i) => i.id).join()) return;
    setData((d) => d && { categories: d.categories.map((c) => (c.id === cat.id ? { ...c, items: ids.map((id) => c.items.find((i) => i.id === id)!) } : c)) });
    void run(() => dashPost('items-reorder', { category_id: cat.id, ids }));
  };
  const reorderCats = (from: number, to: number) => {
    const ids = move(cats, from, to).map((c) => c.id);
    if (ids.join() === cats.map((c) => c.id).join()) return;
    void run(() => dashPost('categories-reorder', { ids }));
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedIds = [...selected];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Menu</h1>
        <button type="button" className={btnPrimary} disabled={cats.length === 0} onClick={() => setItemDlg({ item: null, categoryId: cats[0]!.id })}><IconPlus /> Add dish</button>
        <button type="button" className={btnSecondary} onClick={() => setCatDlg({ cat: null })}>Add category</button>
        <button type="button" className={btnSecondary} onClick={() => setCsvDlg(true)}>Import CSV</button>
        <button type="button" className={btnSecondary} disabled={cats.every((c) => c.items.length === 0)} onClick={() => setSelected(new Set(cats.flatMap((c) => c.items.map((i) => i.id))))}>Select all dishes</button>
        <button type="button" className={btnSecondary} disabled={cats.length === 0} onClick={() => download('menu.csv', menuToCsv({ categories: cats }))}>Export CSV</button>
      </div>
      <div className="mt-3 space-y-2" aria-live="polite">
        {error && <Alert>{error}</Alert>}
        {err && <Alert>{err}</Alert>}
        {msg && <Notice>{msg}</Notice>}
      </div>
      {!data && !error && <p className="mt-6 text-stone-700">Loading…</p>}
      {data && cats.length === 0 && <p className="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-6 text-stone-800">Your menu is empty. Add a category first (for example “Starters”), then add dishes to it. You can also import a whole menu from a spreadsheet.</p>}

      <div className="mt-4 space-y-6">
        {cats.map((cat, ci) => (
          <section key={cat.id} aria-label={cat.name} className="rounded-2xl border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-3">
              <h2 className="mr-auto text-lg font-bold">{cat.name}{!cat.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold">Hidden</span>}</h2>
              <button type="button" className={smallBtn} aria-label={`Move category ${cat.name} up`} disabled={ci === 0 || busy} onClick={() => reorderCats(ci, ci - 1)}>↑</button>
              <button type="button" className={smallBtn} aria-label={`Move category ${cat.name} down`} disabled={ci === cats.length - 1 || busy} onClick={() => reorderCats(ci, ci + 1)}>↓</button>
              {cat.items.length > 0 && <button type="button" className={smallBtn} onClick={() => setSelected((s) => { const n = new Set(s); const all = cat.items.every((i) => n.has(i.id)); for (const i of cat.items) { if (all) n.delete(i.id); else n.add(i.id); } return n; })}>{cat.items.every((i) => selected.has(i.id)) ? 'Unselect all' : 'Select all'}</button>}
              <button type="button" className={smallBtn} onClick={() => setItemDlg({ item: null, categoryId: cat.id })}>Add dish</button>
              <button type="button" className={smallBtn} onClick={() => setCatDlg({ cat })}>Rename</button>
              <button type="button" className={smallBtn} onClick={() => setConfirm({ title: cat.items.length ? `Delete category “${cat.name}” and its ${cat.items.length} dish(es)?` : `Delete category “${cat.name}”?`, body: cat.items.length ? 'Every dish in this category is deleted too. Past orders keep their record of these dishes. This cannot be undone.' : 'This cannot be undone.', action: () => dashPost(cat.items.length ? 'category-delete-all' : 'category-delete', { id: cat.id }).then(() => undefined) })}>Delete</button>
            </div>
            {cat.items.length === 0 && <p className="px-4 py-4 text-sm text-stone-700">No dishes in this category yet.</p>}
            <ul>
              {cat.items.map((it, ii) => (
                <li
                  key={it.id}
                  draggable
                  onDragStart={() => { drag.current = { cat: cat.id, id: it.id }; }}
                  onDragOver={(e) => { if (drag.current?.cat === cat.id) e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = cat.items.findIndex((x) => x.id === drag.current?.id);
                    if (drag.current?.cat === cat.id && from >= 0) reorderItems(cat, from, ii);
                    drag.current = null;
                  }}
                  className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-b-0"
                >
                  <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                    <input type="checkbox" className="h-5 w-5" checked={selected.has(it.id)} onChange={() => toggle(it.id)} aria-label={`Select ${it.name}`} />
                  </label>
                  {it.image_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${imageBase}${it.image_path}`} alt="" width={56} height={56} loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span aria-hidden className="h-14 w-14 shrink-0 rounded-lg bg-stone-100" />
                  )}
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="font-semibold">{it.name}</p>
                    <p className="text-sm text-stone-700">
                      {(it.variants?.length ?? 0) > 0 ? `from ${formatPaise(it.price_paise)} · ${it.variants!.length} sizes` : formatPaise(it.price_paise)} · {DIET_LABEL[it.diet]}{it.spice > 0 ? ` · Spice ${it.spice}` : ''}
                      {(it.groups?.length ?? 0) > 0 && ` · ${it.groups!.length} option group${it.groups!.length === 1 ? '' : 's'}`}
                      {it.is_bestseller && ' · Bestseller'}{it.is_chef_pick && " · Chef's pick"}
                    </p>
                  </div>
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" role="switch" className="h-5 w-5" checked={it.is_available} disabled={busy} onChange={(e) => void run(() => dashPost('item-save', toItemBody(it, cat.id, { is_available: e.target.checked })))} />
                    {it.is_available ? 'Available' : 'Sold out'}
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className={smallBtn} aria-label={`Move ${it.name} up`} disabled={ii === 0 || busy} onClick={() => reorderItems(cat, ii, ii - 1)}>↑</button>
                    <button type="button" className={smallBtn} aria-label={`Move ${it.name} down`} disabled={ii === cat.items.length - 1 || busy} onClick={() => reorderItems(cat, ii, ii + 1)}>↓</button>
                    <button type="button" className={smallBtn} onClick={() => setItemDlg({ item: it, categoryId: cat.id })} aria-label={`Edit ${it.name}`}>Edit</button>
                    <button type="button" className={smallBtn} disabled={busy} onClick={() => void run(() => dashPost('item-duplicate', { id: it.id }), `Copied “${it.name}”. The copy is marked sold out until you edit it.`)} aria-label={`Duplicate ${it.name}`}>Duplicate</button>
                    <button type="button" className={smallBtn} onClick={() => setConfirm({ title: `Delete “${it.name}”?`, body: 'Past orders keep their record of this dish. This cannot be undone.', action: () => dashPost('item-delete', { id: it.id }).then(() => undefined) })} aria-label={`Delete ${it.name}`}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {selected.size > 0 && (
        <div role="region" aria-label="Bulk actions" className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-300 bg-white px-4 py-3 shadow-lg">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <p className="mr-auto font-semibold">{selected.size} selected</p>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run(async () => { for (const part of chunk(selectedIds, 300)) await dashPost('items-availability', { item_ids: part, available: true }); setSelected(new Set()); }, 'Marked available.')}>Mark available</button>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run(async () => { for (const part of chunk(selectedIds, 300)) await dashPost('items-availability', { item_ids: part, available: false }); setSelected(new Set()); }, 'Marked sold out.')}>Mark sold out</button>
            <button type="button" className={btnSecondary} onClick={() => setPriceDlg(true)}>Change prices</button>
            <button type="button" className={`${btnSecondary} !border-red-800 !text-red-900`} disabled={busy} onClick={() => setConfirm({ title: `Delete ${selected.size} dish(es)?`, body: 'The selected dishes are deleted for good. Past orders keep their record of them. This cannot be undone.', action: async () => { for (const part of chunk(selectedIds, 500)) await dashPost('items-delete', { item_ids: part }); setSelected(new Set()); } })}>Delete selected</button>
            <button type="button" className={btnSecondary} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <ItemDialog
        state={itemDlg}
        cats={cats}
        restaurantId={restaurantId}
        supabase={supabase}
        imageBase={imageBase}
        onClose={() => setItemDlg(null)}
        onSave={async (body, choices, hadChoices) => {
          const ok = await run(async () => {
            // nothing to send for a dish that has no sizes or options and never had any
            const hasChoices = hadChoices || choices.variants.length > 0 || choices.groups.length > 0;
            const send = (itemId: string) => dashPost('item-choices-save', { item_id: itemId, variants: choices.variants, groups: choices.groups });
            // An existing dish gets its sizes first, so that removing every size lets the typed price stand; a new dish needs its id first.
            const existing = typeof body.id === 'string' ? body.id : null;
            if (existing && hasChoices) await send(existing);
            const saved = await dashPost<{ id: string }>('item-save', body);
            if (!existing && hasChoices) await send(saved.id);
          }, 'Saved.');
          if (ok) setItemDlg(null);
          return ok;
        }}
        error={err}
      />
      <CategoryDialog state={catDlg} onClose={() => setCatDlg(null)} onSave={async (body) => { const ok = await run(() => dashPost('category-save', body), 'Saved.'); if (ok) setCatDlg(null); }} error={err} />
      <PriceDialog open={priceDlg} count={selected.size} busy={busy} error={err} onClose={() => setPriceDlg(false)} onApply={async (mode, value) => { const ok = await run(() => dashPost('items-bulk-price', { item_ids: selectedIds, mode, value }), 'Prices updated.'); if (ok) { setPriceDlg(false); setSelected(new Set()); } }} />
      <CsvDialog open={csvDlg} onClose={() => setCsvDlg(false)} onDone={(m) => { setCsvDlg(false); setMsg(m); void reload(); }} />
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? ''} closeLabel="Close">
        <p className="text-stone-800">{confirm?.body}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setConfirm(null)}>Cancel</button>
          <button type="button" className={`${btnPrimary} flex-1`} disabled={busy} onClick={async () => { const c = confirm; setConfirm(null); if (c) await run(c.action, 'Done.'); }}>Yes, delete</button>
        </div>
      </Sheet>
    </div>
  );
}

const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

function toItemBody(it: Item, categoryId: string, over: Partial<Item> = {}) {
  const m = { ...it, ...over };
  return { id: it.id, category_id: categoryId, name: m.name, description: m.description, price_paise: m.price_paise, diet: m.diet, spice: m.spice, image_path: m.image_path, is_bestseller: m.is_bestseller, is_chef_pick: m.is_chef_pick, is_available: m.is_available };
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function CategoryDialog({ state, onClose, onSave, error }: { state: { cat: Category | null } | null; onClose: () => void; onSave: (b: { id: string | null; name: string; active: boolean }) => Promise<void>; error: string | null }) {
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const key = state ? (state.cat?.id ?? 'new') : '';
  const [seen, setSeen] = useState('');
  if (key !== seen) { setSeen(key); setName(state?.cat?.name ?? ''); setActive(state?.cat?.active ?? true); }
  return (
    <Sheet open={!!state} onClose={onClose} title={state?.cat ? 'Edit category' : 'Add category'} closeLabel="Close">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void onSave({ id: state?.cat?.id ?? null, name, active }); }}>
        <label className="block text-sm font-semibold">Category name
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} /> Show this category to guests</label>
        {error && <Alert>{error}</Alert>}
        <button type="submit" className={`${btnPrimary} w-full`}>Save</button>
      </form>
    </Sheet>
  );
}

function PriceDialog({ open, count, busy, error, onClose, onApply }: { open: boolean; count: number; busy: boolean; error: string | null; onClose: () => void; onApply: (mode: 'percent' | 'add' | 'set', value: number) => Promise<void> }) {
  const [mode, setMode] = useState<'percent' | 'add' | 'set'>('percent');
  const [val, setVal] = useState('');
  const [bad, setBad] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title={`Change prices (${count} dishes)`} closeLabel="Close">
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        setBad(null);
        const n = Number(val.replace(/,/g, ''));
        if (!Number.isFinite(n) || val.trim() === '') return setBad('Enter a number.');
        // percent stays a percent; rupee amounts go to the server as paise
        void onApply(mode, mode === 'percent' ? n : Math.round(n * 100));
      }}>
        <fieldset>
          <legend className="text-sm font-semibold">How should prices change?</legend>
          {([['percent', 'Change by a percentage (for example 10, or -5)'], ['add', 'Add or subtract rupees (for example 20, or -10)'], ['set', 'Set every selected dish to one price']] as const).map(([k, label]) => (
            <label key={k} className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="mode" className="h-5 w-5" checked={mode === k} onChange={() => setMode(k)} /> {label}</label>
          ))}
        </fieldset>
        <label className="block text-sm font-semibold">{mode === 'percent' ? 'Percent' : 'Rupees'}
          <input inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} className={inputCls} />
        </label>
        {(bad || error) && <Alert>{bad ?? error}</Alert>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Apply to {count} dishes</button>
      </form>
    </Sheet>
  );
}

function CsvDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [parsed, setParsed] = useState<ParsedMenuCsv | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<{ row: number; message: string }[]>([]);
  const reset = () => { setParsed(null); setFileName(''); setErr(null); setServerIssues([]); };
  const bad = parsed ? parsed.issues.length : 0;
  return (
    <Sheet open={open} onClose={() => { reset(); onClose(); }} title="Import menu from CSV" closeLabel="Close">
      <div className="space-y-4">
        <p className="text-sm text-stone-800">Upload a CSV file saved from Excel or Google Sheets. Dishes that already exist (same category and name) are updated; new ones are added. Nothing is changed unless every row is correct.</p>
        <button type="button" className={btnSecondary} onClick={() => download('menu-sample.csv', SAMPLE_CSV)}>Download a sample file</button>
        <label className="block text-sm font-semibold">Choose your CSV file
          <input type="file" accept=".csv,text/csv" className="mt-1 block min-h-11 w-full text-base" onChange={async (e) => {
            const f = e.target.files?.[0];
            reset();
            if (!f) return;
            setFileName(f.name);
            setParsed(parseMenuCsv(await f.text()));
          }} />
        </label>
        {parsed?.fatal && <Alert>{parsed.fatal}</Alert>}
        {parsed && !parsed.fatal && (
          <>
            <p role="status" className="font-semibold">{fileName}: {parsed.preview.length} rows, {bad === 0 ? 'all look good' : `${bad} with problems`}.</p>
            <div className="max-h-64 overflow-auto rounded-xl border border-stone-200">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Preview of the file</caption>
                <thead className="bg-stone-100"><tr><th scope="col" className="px-2 py-2">Row</th><th scope="col" className="px-2 py-2">Category</th><th scope="col" className="px-2 py-2">Dish</th><th scope="col" className="px-2 py-2">Price</th><th scope="col" className="px-2 py-2">Check</th></tr></thead>
                <tbody>
                  {parsed.preview.slice(0, 100).map((r) => (
                    <tr key={r.row} className={r.ok ? '' : 'bg-red-50'}>
                      <td className="px-2 py-1">{r.row}</td><td className="px-2 py-1">{r.cells.category}</td><td className="px-2 py-1">{r.cells.name}</td><td className="px-2 py-1">{r.cells.price}</td>
                      <td className="px-2 py-1">{r.ok ? 'OK' : r.messages.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.preview.length > 100 && <p className="text-sm text-stone-700">Showing the first 100 rows. All rows are checked.</p>}
          </>
        )}
        {serverIssues.length > 0 && <Alert>{serverIssues.map((i) => `Row ${i.row}: ${i.message}`).join(' · ')}</Alert>}
        {err && <Alert>{err}</Alert>}
        <button type="button" className={`${btnPrimary} w-full`} disabled={busy || !parsed || !!parsed.fatal || bad > 0 || parsed.rows.length === 0} onClick={async () => {
          if (!parsed) return;
          setBusy(true); setErr(null); setServerIssues([]);
          try {
            const r = await dashPost<{ ok: boolean; created?: number; updated?: number; errors?: { row: number; message: string }[] }>('menu-import', { rows: parsed.rows });
            if (!r.ok) setServerIssues(r.errors ?? []);
            else { reset(); onDone(`Imported: ${r.created} added, ${r.updated} updated.`); }
          } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
        }}>{bad > 0 ? 'Fix the rows marked in red, then upload again' : 'Import menu'}</button>
      </div>
    </Sheet>
  );
}

function ItemDialog({ state, cats, restaurantId, supabase, imageBase, onClose, onSave, error }: {
  state: { item: Item | null; categoryId: string } | null; cats: Category[]; restaurantId: string; supabase: { url: string; anonKey: string }; imageBase: string;
  onClose: () => void; onSave: (body: Record<string, unknown>, choices: Extract<ChoicesPayload, { ok: true }>, hadChoices: boolean) => Promise<boolean>; error: string | null;
}) {
  const sb = useMemo(() => createBrowserClient(supabase.url, supabase.anonKey), [supabase.url, supabase.anonKey]);
  const [f, setF] = useState({ name: '', description: '', price: '', categoryId: '', diet: 'veg' as Diet, spice: 0, bestseller: false, chef: false, available: true, image: null as string | null });
  const [choices, setChoices] = useState<Drafts>({ variants: [], groups: [] });
  const [local, setLocal] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [seen, setSeen] = useState('');
  const key = state ? `${state.item?.id ?? 'new'}:${state.categoryId}` : '';
  if (key !== seen) {
    setSeen(key);
    const it = state?.item;
    setF({ name: it?.name ?? '', description: it?.description ?? '', price: it ? rupees(it.price_paise) : '', categoryId: state?.categoryId ?? '', diet: it?.diet ?? 'veg', spice: it?.spice ?? 0, bestseller: it?.is_bestseller ?? false, chef: it?.is_chef_pick ?? false, available: it?.is_available ?? true, image: it?.image_path ?? null });
    setChoices(draftsFromItem(it));
    setLocal(null);
    setProblem(null);
  }
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setUploading(true);
    try {
      const blob = await compressToWebp(file);
      const path = `${restaurantId}/${crypto.randomUUID()}.webp`;
      const { error: upErr } = await sb.storage.from('menu-images').upload(path, blob, { contentType: 'image/webp', upsert: false });
      if (upErr) throw new Error('The photo could not be uploaded. Please try again.');
      const old = f.image;
      set('image', path);
      setLocal(URL.createObjectURL(blob));
      // the previous photo is no longer used by this dish; removing it is best-effort tidy-up
      if (old && old !== state?.item?.image_path) void sb.storage.from('menu-images').remove([old]);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The photo could not be uploaded.');
    } finally {
      setUploading(false);
    }
  }

  const preview = local ?? (f.image ? `${imageBase}${f.image}` : null);
  return (
    <Sheet open={!!state} onClose={onClose} title={state?.item ? `Edit ${state.item.name}` : 'Add dish'} closeLabel="Close">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setProblem(null);
        const parsed = choicesPayload(choices);
        if (!parsed.ok) return setProblem(parsed.error);
        // a dish with sizes takes its price from its cheapest size
        const paise = parsed.cheapest ?? parseRupeesToPaise(f.price);
        if (paise === null || paise > 10_000_000) return setProblem('Enter the price in rupees, for example 250 or 249.50.');
        await onSave({ id: state?.item?.id ?? null, category_id: f.categoryId, name: f.name, description: f.description || null, price_paise: paise, diet: f.diet, spice: f.spice, image_path: f.image, is_bestseller: f.bestseller, is_chef_pick: f.chef, is_available: f.available }, parsed, (state?.item?.variants?.length ?? 0) + (state?.item?.groups?.length ?? 0) > 0);
      }}>
        <label className="block text-sm font-semibold">Dish name
          <input required maxLength={80} value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </label>
        <label className="block text-sm font-semibold">Category
          <select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} className={inputCls}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="block text-sm font-semibold">Description (optional)
          <textarea maxLength={300} rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-base font-normal" />
        </label>
        <label className="block text-sm font-semibold">Price (₹)
          <input required={choices.variants.length === 0} inputMode="decimal" value={choices.variants.length > 0 ? '' : f.price} disabled={choices.variants.length > 0} placeholder={choices.variants.length > 0 ? 'Set by the sizes below' : ''} onChange={(e) => set('price', e.target.value)} className={inputCls} />
        </label>
        <ChoicesEditor value={choices} onChange={setChoices} />
        <fieldset>
          <legend className="text-sm font-semibold">Food type</legend>
          <div className="flex flex-wrap gap-x-4">
            {(Object.keys(DIET_LABEL) as Diet[]).map((d) => (
              <label key={d} className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="diet" className="h-5 w-5" checked={f.diet === d} onChange={() => set('diet', d)} /> {DIET_LABEL[d]}</label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-semibold">Spice level
          <select value={f.spice} onChange={(e) => set('spice', Number(e.target.value))} className={inputCls}>
            <option value={0}>Not spicy</option><option value={1}>Mild</option><option value={2}>Medium</option><option value={3}>Hot</option>
          </select>
        </label>
        <div className="space-y-1">
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={f.bestseller} onChange={(e) => set('bestseller', e.target.checked)} /> Bestseller badge</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={f.chef} onChange={(e) => set('chef', e.target.checked)} /> Chef&apos;s pick badge</label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={f.available} onChange={(e) => set('available', e.target.checked)} /> Available today</label>
        </div>
        <div>
          <p className="text-sm font-semibold">Photo (optional)</p>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Dish photo preview" width={160} height={160} className="mt-2 h-40 w-40 rounded-xl object-cover" />
          )}
          <label className="mt-2 block text-sm font-semibold">Choose a photo
            <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo" disabled={uploading} className="mt-1 block min-h-11 w-full text-base" onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          <p className="text-sm text-stone-700">{uploading ? 'Shrinking and uploading…' : 'Photos are shrunk automatically so the menu loads fast.'}</p>
          {f.image && <button type="button" className={`${btnSecondary} mt-2`} onClick={() => { set('image', null); setLocal(null); }}>Remove photo</button>}
        </div>
        {(problem || error) && <Alert>{problem ?? error}</Alert>}
        <button type="submit" disabled={uploading} className={`${btnPrimary} w-full`}>Save dish</button>
      </form>
    </Sheet>
  );
}
