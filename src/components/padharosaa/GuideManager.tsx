'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { discoverLabel } from '@/lib/padharosaa/places';

type Cat = 'place' | 'food' | 'craft' | 'tip';
interface Item { id: string; category: Cat; name: string; description_en: string | null; description_hi: string | null; maps_query: string | null; link_url: string | null; address: string | null; best_time: string | null; lat: number | null; lng: number | null; active: boolean; needs_review: boolean; source: string }
interface Stop { id?: string; when_label: string; name: string; note: string | null; maps_query: string | null; lat: number | null; lng: number | null }
interface Itin { id?: string; name: string; tagline: string | null; tip: string | null; active: boolean; stops: Stop[] }
interface Manage { location: { lat: number; lng: number } | null; items: Item[]; itineraries: Itin[]; ai_available: boolean }
interface Cand { category: 'place' | 'food' | 'craft'; name: string; lat: number; lng: number; address: string | null; kind: string; distance_m: number; already: boolean }

const CAT_LABEL: Record<Cat, string> = { place: 'Place', food: 'Food', craft: 'Craft', tip: 'Tip' };
const inputCls = 'mt-1 min-h-11 w-full rounded-xl border-2 border-stone-300 bg-white px-3 text-base text-stone-900';
const btn = 'min-h-11 rounded-xl bg-stone-900 px-4 text-sm font-bold text-white disabled:opacity-50';
const btn2 = 'min-h-11 rounded-xl border-2 border-stone-700 px-4 text-sm font-bold text-stone-900 disabled:opacity-50';
const base = '/api/padharosaa/v1/staff';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-semibold">{label}{children}</label>;
}

export function GuideManager({ flash }: { flash: (ok: boolean, t: string) => void }) {
  const [g, setG] = useState<Manage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [radius, setRadius] = useState(3000);
  const [loc, setLoc] = useState({ lat: '', lng: '' });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [itin, setItin] = useState<Itin | null>(null);

  const load = useCallback(async () => {
    try { const d = await apiGet<Manage>(`${base}/guide`); setG(d); if (d.location) setLoc({ lat: String(d.location.lat), lng: String(d.location.lng) }); } catch { flash(false, 'The guide could not be loaded.'); }
  }, [flash]);
  useEffect(() => { void load(); }, [load]);

  const run = async (name: string, fn: () => Promise<void>) => { setBusy(name); try { await fn(); } catch { flash(false, 'That did not go through. Please check and try again.'); } setBusy(null); };
  const post = <T,>(action: string, body: unknown) => apiPost<T>(`${base}/guide/${action}`, body);

  const saveLoc = () => run('loc', async () => { await post('location', { lat: Number(loc.lat), lng: Number(loc.lng) }); flash(true, 'Hotel location saved.'); await load(); });
  const here = () => navigator.geolocation?.getCurrentPosition((p) => setLoc({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }), () => flash(false, 'Could not read your location. Type the numbers instead.'), { timeout: 10000 });
  const find = () => run('find', async () => {
    const r = await post<{ ok: boolean; reason?: string; candidates: Cand[] }>('discover', { radius_m: radius });
    if (!r.ok) { flash(false, 'The free map service did not answer. Please try again in a minute, or add places by hand.'); return; }
    setCands(r.candidates); setPicked(new Set());
    if (r.candidates.length === 0) flash(true, 'No named places found in this radius. Try a bigger radius.');
  });
  const importPicked = () => run('import', async () => {
    const items = (cands ?? []).filter((c) => picked.has(`${c.category}:${c.name}`)).map((c) => ({ category: c.category, name: c.name, lat: c.lat, lng: c.lng, ...(c.address ? { address: c.address } : {}) }));
    if (!items.length) return;
    await post('import', { items }); setCands(null); flash(true, `${items.length} added as drafts. Read them, then publish.`); await load();
  });
  const ai = (ids: string[]) => run('ai', async () => {
    const r = await post<{ ok: boolean; reason?: string; drafted?: number }>('describe', { ids: ids.slice(0, 10) });
    if (!r.ok) flash(false, r.reason === 'not_configured' ? 'AI is not switched on for this app. Please write the descriptions yourself.' : 'The AI service did not answer. Please write the descriptions yourself, or try again.');
    else flash(true, `${r.drafted ?? 0} description(s) drafted. Please read and edit them before publishing.`);
    await load();
  });
  const saveItem = (it: Partial<Item> & { category: Cat; name: string }, publish: boolean) => run('save', async () => {
    const body = { ...it, link_url: it.link_url || undefined, lat: it.lat ?? undefined, lng: it.lng ?? undefined, description_en: it.description_en ?? undefined, description_hi: it.description_hi ?? undefined, maps_query: it.maps_query ?? undefined, address: it.address ?? undefined, best_time: it.best_time ?? undefined, publish };
    await post('save', body); setEditing(null); flash(true, publish ? 'Published. Guests can see it now.' : 'Saved.'); await load();
  });
  const archive = (id: string) => run('arch', async () => { await post('archive', { id }); await load(); });
  const saveItin = () => run('itin', async () => { if (!itin) return; await post('itinerary', { ...itin, tagline: itin.tagline ?? undefined, tip: itin.tip ?? undefined, stops: itin.stops.map((s) => ({ ...s, note: s.note ?? undefined, maps_query: s.maps_query ?? undefined, lat: s.lat ?? undefined, lng: s.lng ?? undefined })) }); setItin(null); flash(true, 'Day plan saved.'); await load(); });

  if (!g) return <p className="mt-4 text-center">Loading the guide…</p>;
  const drafts = g.items.filter((i) => i.needs_review), live = g.items.filter((i) => !i.needs_review);
  return (
    <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="guide-h">
      <h2 id="guide-h" className="text-lg font-extrabold">Jaipur guide and day plans</h2>
      <p className="text-sm text-stone-700">Guests only see what you publish. Places found on the map and AI-written text always arrive as drafts for you to read first.</p>

      <div className="mt-3 rounded-xl bg-stone-50 p-3">
        <h3 className="font-bold">1. Hotel location</h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Latitude"><input inputMode="decimal" className={inputCls} value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: e.target.value })} /></Field>
          <Field label="Longitude"><input inputMode="decimal" className={inputCls} value={loc.lng} onChange={(e) => setLoc({ ...loc, lng: e.target.value })} /></Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={btn2} onClick={here}>Use my current location</button><button type="button" className={btn} disabled={busy === 'loc' || !loc.lat || !loc.lng} onClick={() => void saveLoc()}>Save location</button></div>
        <p className="mt-1 text-xs text-stone-700">Stand inside the hotel and tap “Use my current location”. Guests then see distances and directions from here.</p>
      </div>

      <div className="mt-3 rounded-xl bg-stone-50 p-3">
        <h3 className="font-bold">2. Find places near the hotel (free map data)</h3>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="Within"><select className={inputCls} value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{[2000, 3000, 5000, 10000].map((r) => <option key={r} value={r}>{r / 1000} km</option>)}</select></Field>
          <button type="button" className={btn} disabled={!g.location || busy === 'find'} onClick={() => void find()}>{busy === 'find' ? 'Searching…' : 'Find places'}</button>
        </div>
        {!g.location && <p className="mt-1 text-sm font-semibold text-amber-900">Save the hotel location first.</p>}
        {cands && cands.length > 0 && (
          <div className="mt-3">
            <ul className="max-h-80 space-y-1 overflow-y-auto">{cands.map((c) => { const k = `${c.category}:${c.name}`; return (
              <li key={k}><label className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1 hover:bg-stone-100"><input type="checkbox" className="h-5 w-5" disabled={c.already} checked={picked.has(k) || c.already} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                <span><b>{c.name}</b> <span className="text-sm text-stone-700">· {CAT_LABEL[c.category]} · {discoverLabel(c.distance_m)}{c.already ? ' · already added' : ''}</span></span></label></li>); })}</ul>
            <button type="button" className={btn + ' mt-2'} disabled={picked.size === 0 || busy === 'import'} onClick={() => void importPicked()}>Add {picked.size} selected as drafts</button>
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">3. Drafts to review ({drafts.length})</h3>
          {drafts.length > 0 && <button type="button" className={btn2} disabled={!g.ai_available || busy === 'ai'} onClick={() => void ai(drafts.map((d) => d.id))} title={g.ai_available ? '' : 'AI is not switched on. Write the text yourself.'}>{busy === 'ai' ? 'Writing…' : g.ai_available ? 'Write descriptions with AI' : 'AI not switched on'}</button>}</div>
        {drafts.length === 0 && <p className="text-sm text-stone-700">No drafts. Use “Find places” above, or add one by hand.</p>}
        <ul className="mt-2 space-y-2">{drafts.map((i) => <ItemRow key={i.id} item={i} open={editing === i.id} onOpen={() => setEditing(editing === i.id ? null : i.id)} onSave={saveItem} onArchive={archive} />)}</ul>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-2"><h3 className="font-bold">4. Published ({live.length})</h3><button type="button" className={btn2} onClick={() => setEditing(editing === 'new' ? null : 'new')}>+ Add by hand</button></div>
        {editing === 'new' && <ul className="mt-2"><ItemRow item={{ id: '', category: 'place', name: '', description_en: '', description_hi: '', maps_query: '', link_url: '', address: '', best_time: '', lat: null, lng: null, active: true, needs_review: false, source: 'manual' }} open onOpen={() => setEditing(null)} onSave={saveItem} onArchive={archive} isNew /></ul>}
        <ul className="mt-2 space-y-2">{live.map((i) => <ItemRow key={i.id} item={i} open={editing === i.id} onOpen={() => setEditing(editing === i.id ? null : i.id)} onSave={saveItem} onArchive={archive} />)}</ul>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2"><h3 className="font-bold">5. Day plans ({g.itineraries.length})</h3><button type="button" className={btn2} onClick={() => setItin({ name: '', tagline: '', tip: '', active: true, stops: [{ when_label: 'Day 1 · 9:00', name: '', note: '', maps_query: null, lat: null, lng: null }] })}>+ New day plan</button></div>
        <ul className="mt-2 space-y-2">{g.itineraries.map((i) => <li key={i.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-stone-200 p-3"><span><b>{i.name}</b> <span className="text-sm text-stone-700">· {i.stops.length} stops{i.active ? '' : ' · hidden'}</span></span>
          <span className="flex gap-2"><button type="button" className={btn2} onClick={() => setItin({ ...i })}>Edit</button><button type="button" className={btn2} onClick={() => void run('ia', async () => { await apiPost(`${base}/guide/itinerary-archive`, { id: i.id }); await load(); })}>Remove</button></span></li>)}</ul>
        {itin && (
          <div className="mt-2 space-y-2 rounded-xl bg-stone-50 p-3">
            <Field label="Name (e.g. The 48-hour classic)"><input className={inputCls} maxLength={100} value={itin.name} onChange={(e) => setItin({ ...itin, name: e.target.value })} /></Field>
            <Field label="One line about it"><input className={inputCls} maxLength={160} value={itin.tagline ?? ''} onChange={(e) => setItin({ ...itin, tagline: e.target.value })} /></Field>
            <Field label="Tip for guests"><input className={inputCls} maxLength={400} value={itin.tip ?? ''} onChange={(e) => setItin({ ...itin, tip: e.target.value })} /></Field>
            {itin.stops.map((s, n) => (
              <div key={n} className="grid gap-2 rounded-lg border border-stone-300 p-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
                <input aria-label={`Stop ${n + 1} time`} className={inputCls + ' !mt-0'} placeholder="Day 1 · 9:00" maxLength={40} value={s.when_label} onChange={(e) => setItin({ ...itin, stops: itin.stops.map((x, k) => (k === n ? { ...x, when_label: e.target.value } : x)) })} />
                <input aria-label={`Stop ${n + 1} name`} className={inputCls + ' !mt-0'} placeholder="Amer Fort" maxLength={100} value={s.name} onChange={(e) => setItin({ ...itin, stops: itin.stops.map((x, k) => (k === n ? { ...x, name: e.target.value } : x)) })} />
                <input aria-label={`Stop ${n + 1} note`} className={inputCls + ' !mt-0'} placeholder="Go early, it is cooler" maxLength={300} value={s.note ?? ''} onChange={(e) => setItin({ ...itin, stops: itin.stops.map((x, k) => (k === n ? { ...x, note: e.target.value } : x)) })} />
                <button type="button" className={btn2} onClick={() => setItin({ ...itin, stops: itin.stops.filter((_, k) => k !== n) })}>Remove</button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2"><button type="button" className={btn2} disabled={itin.stops.length >= 30} onClick={() => setItin({ ...itin, stops: [...itin.stops, { when_label: '', name: '', note: '', maps_query: null, lat: null, lng: null }] })}>+ Add stop</button>
              <button type="button" className={btn} disabled={busy === 'itin' || !itin.name.trim() || itin.stops.some((s) => !s.name.trim() || !s.when_label.trim())} onClick={() => void saveItin()}>Save day plan</button><button type="button" className={btn2} onClick={() => setItin(null)}>Cancel</button></div>
          </div>
        )}
      </div>
    </section>
  );
}

function ItemRow({ item, open, onOpen, onSave, onArchive, isNew }: { item: Item; open: boolean; onOpen: () => void; onSave: (i: Partial<Item> & { category: Cat; name: string }, publish: boolean) => void; onArchive: (id: string) => void; isNew?: boolean }) {
  const [f, setF] = useState(item);
  const set = (k: keyof Item) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <li className="rounded-xl border-2 border-stone-200 p-3">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" onClick={onOpen} aria-expanded={open}>
        <span><b>{item.name || 'New item'}</b> <span className="text-sm text-stone-700">· {CAT_LABEL[item.category]}{item.needs_review ? ` · draft (${item.source === 'ai_draft' ? 'AI wording' : 'from map'})` : item.active ? '' : ' · hidden'}</span></span><span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Type"><select className={inputCls} value={f.category} onChange={set('category')}>{(Object.keys(CAT_LABEL) as Cat[]).map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select></Field>
            <Field label="Name"><input className={inputCls} maxLength={100} value={f.name} onChange={set('name')} /></Field>
          </div>
          <Field label="Description (English)"><textarea rows={3} maxLength={600} className={inputCls} value={f.description_en ?? ''} onChange={set('description_en')} /></Field>
          <Field label="Description (Hindi, optional)"><textarea rows={3} maxLength={600} className={inputCls} value={f.description_hi ?? ''} onChange={set('description_hi')} /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Best time (e.g. early morning)"><input className={inputCls} maxLength={100} value={f.best_time ?? ''} onChange={set('best_time')} /></Field>
            <Field label="Address or area"><input className={inputCls} maxLength={200} value={f.address ?? ''} onChange={set('address')} /></Field>
            <Field label="Search words for Google Maps (if no exact spot)"><input className={inputCls} maxLength={200} value={f.maps_query ?? ''} onChange={set('maps_query')} /></Field>
            <Field label="Website (https)"><input className={inputCls} value={f.link_url ?? ''} onChange={set('link_url')} /></Field>
          </div>
          <p className="text-xs text-stone-700">Opening hours and prices change: only write them if you have checked them.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!f.name.trim()} onClick={() => onSave({ ...f, lat: f.lat, lng: f.lng, id: isNew ? undefined : f.id }, true)}>{item.needs_review || isNew ? 'Publish for guests' : 'Save and keep published'}</button>
            {!isNew && !item.needs_review && <button type="button" className={btn2} onClick={() => onSave({ ...f, active: !f.active }, false)}>{f.active ? 'Hide from guests' : 'Show to guests'}</button>}
            {item.needs_review && <button type="button" className={btn2} onClick={() => onSave({ ...f }, false)}>Save as draft</button>}
            {!isNew && <button type="button" className={btn2} onClick={() => onArchive(item.id)}>Remove</button>}
          </div>
        </div>
      )}
    </li>
  );
}
