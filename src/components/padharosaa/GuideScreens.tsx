'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { discoverLabel, haversineMeters, mapsDirectionsUrl, tidyPlaceName } from '@/lib/padharosaa/places';
import { fill, type Copy } from './copy';
import { BuffetAlerts } from './BuffetAlerts';
import { Btn, Header, api } from './shared';

interface Item { id: string; category: 'place' | 'food' | 'craft' | 'tip'; name: string; description: string | null; maps_query: string | null; link_url: string | null; address: string | null; best_time: string | null; lat: number | null; lng: number | null }
interface Stop { when_label: string; name: string; note: string | null; maps_query: string | null; lat: number | null; lng: number | null }
interface Itinerary { id: string; name: string; tagline: string | null; tip: string | null; stops: Stop[] }
interface Guide { hotel: { lat: number; lng: number } | null; items: Item[]; itineraries: Itinerary[] }
interface PlanItem { id: string; name: string; when_label: string | null; maps_query: string | null; lat: number | null; lng: number | null }
interface Plan { requested_at: string | null; items: PlanItem[] }

const num = (v: number | null | undefined): v is number => typeof v === 'number';
/** Names imported from a map can start with a stray ":" or "-" and appear twice: show each place once, with a clean name. */
const tidyName = tidyPlaceName;
function tidyItems(items: Item[]): Item[] {
  const seen = new Set<string>();
  return items.map((i) => ({ ...i, name: tidyName(i.name) })).filter((i) => i.name && !seen.has(`${i.category}:${i.name.toLowerCase()}`) && !!seen.add(`${i.category}:${i.name.toLowerCase()}`));
}
const linkCls = 'inline-flex min-h-11 items-center rounded-xl border-2 px-3 text-sm font-bold';

export function GuideScreen({ c, back, goPlan }: { c: Copy; back: () => void; goPlan: () => void }) {
  const [g, setG] = useState<Guide | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tab, setTab] = useState<'place' | 'food' | 'craft' | 'tip' | 'plans'>('place');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void api<Guide>('guide').then((r) => { if (r.ok) { setG(r.data); const first = (['place', 'food', 'craft', 'tip'] as const).find((k) => r.data.items.some((i) => i.category === k)); if (first) setTab(first); else if (r.data.itineraries.length) setTab('plans'); } else setFailed(true); });
    void api<Plan>('plan').then((r) => { if (r.ok) setPlan(r.data); });
  }, []);
  const inPlan = useMemo(() => new Set((plan?.items ?? []).map((i) => i.name.toLowerCase())), [plan]);
  const add = async (name: string, when: string | null, q: string | null, lat: number | null, lng: number | null) => {
    const r = await api<Plan>('plan/add', { method: 'POST', body: JSON.stringify({ name, ...(when ? { when_label: when } : {}), ...(q ? { maps_query: q } : {}), ...(num(lat) && num(lng) ? { lat, lng } : {}) }) });
    if (r.ok) setPlan(r.data);
  };
  const use = async (id: string) => { const r = await api<Plan>('plan/use', { method: 'POST', body: JSON.stringify({ itinerary: id }) }); if (r.ok) { setPlan(r.data); goPlan(); } };
  const items = useMemo(() => tidyItems(g?.items ?? []), [g]);
  // a tab with nothing in it is not shown at all
  const tabs = ([['place', c.tabPlace], ['food', c.tabFood], ['craft', c.tabCraft], ['tip', c.tabTip], ['plans', c.tabPlans]] as const).filter(([k]) => (k === 'plans' ? (g?.itineraries.length ?? 0) > 0 : items.some((i) => i.category === k)));
  const shown = items.filter((i) => i.category === tab);
  const empty = g && g.items.length === 0 && g.itineraries.length === 0;
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} sub={c.guideSub} title={c.guideTitle} />
      <div className="px-5">
        {failed && <p role="alert" className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.failed}</p>}
        {!g && !failed && <p role="status">…</p>}
        {empty && <p className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.guideEmpty}</p>}
        {g && !empty && (
          <>
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-2" role="tablist" aria-label={c.guideTitle}>
              {tabs.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="min-h-11 shrink-0 rounded-full border-2 px-4 text-sm font-bold"
                  style={tab === k ? { background: 'var(--button)', color: 'var(--on-button)', borderColor: 'var(--ink)' } : { background: '#fff', color: '#10131a', borderColor: 'var(--accent-text)' }}>{label}</button>
              ))}
            </div>
            <div className="mt-3 space-y-3">
              {tab !== 'plans' && shown.length === 0 && <p>{c.guideNone}</p>}
              {tab !== 'plans' && shown.map((i) => {
                const dir = mapsDirectionsUrl(g.hotel, { lat: i.lat, lng: i.lng, query: i.maps_query ?? i.name });
                const dist = g.hotel && num(i.lat) && num(i.lng) ? haversineMeters(g.hotel, { lat: i.lat, lng: i.lng }) : null;
                const added = inPlan.has(i.name.toLowerCase());
                return (
                  <article key={i.id} className="rounded-3xl bg-white p-4 text-stone-900 shadow-sm">
                    <h2 className="text-lg font-extrabold">{i.name}</h2>
                    {num(dist) && <p className="text-sm font-semibold" style={{ color: '#4a4f5a' }}>{fill(c.fromHotel, { d: discoverLabel(dist) })}</p>}
                    {i.description && <p className="mt-1">{i.description}</p>}
                    {i.best_time && <p className="mt-1 text-sm">{fill(c.bestTime, { t: i.best_time })}</p>}
                    {i.address && <p className="text-sm" style={{ color: '#4a4f5a' }}>{i.address}</p>}
                    {i.category !== 'tip' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {dir && <a href={dir} target="_blank" rel="noopener noreferrer" className={linkCls} style={{ borderColor: 'var(--accent-text)', color: '#10131a' }}>📍 {c.directions}</a>}
                        {i.link_url && <a href={i.link_url} target="_blank" rel="noopener noreferrer" className={linkCls} style={{ borderColor: 'var(--accent-text)', color: '#10131a' }}>{c.website}</a>}
                        <button type="button" disabled={added} onClick={() => void add(i.name, null, i.maps_query, i.lat, i.lng)} className="min-h-11 rounded-xl px-3 text-sm font-bold disabled:opacity-80" style={{ background: 'var(--button)', color: 'var(--on-button)', boxShadow: 'inset 0 0 0 2px var(--btn-edge)' }}>{added ? c.inPlan : c.addPlan}</button>
                      </div>
                    )}
                  </article>
                );
              })}
              {tab === 'plans' && g.itineraries.map((it) => (
                <article key={it.id} className="rounded-3xl bg-white p-4 text-stone-900 shadow-sm">
                  <h2 className="text-lg font-extrabold">{it.name}</h2>
                  {it.tagline && <p>{it.tagline}</p>}
                  <ol className="mt-2 space-y-2">{it.stops.map((s, n) => (
                    <li key={n} className="flex gap-3"><span className="w-24 shrink-0 text-sm font-bold" style={{ color: '#7a3a2e' }}>{s.when_label}</span>
                      <span><b>{s.name}</b>{s.note && <span className="block text-sm">{s.note}</span>}
                        {mapsDirectionsUrl(g.hotel, { lat: s.lat, lng: s.lng, query: s.maps_query ?? s.name }) && <a className="text-sm font-bold underline" href={mapsDirectionsUrl(g.hotel, { lat: s.lat, lng: s.lng, query: s.maps_query ?? s.name })!} target="_blank" rel="noopener noreferrer">📍 {c.directions}</a>}</span></li>
                  ))}</ol>
                  {it.tip && <p className="mt-2 rounded-xl p-3 text-sm" style={{ background: 'var(--tint)', color: 'var(--on-tint)' }}>{it.tip}</p>}
                  <div className="mt-3"><Btn onClick={() => void use(it.id)}>{c.usePlan}</Btn></div>
                </article>
              ))}
              {tab === 'plans' && g.itineraries.length === 0 && <p>{c.guideNone}</p>}
            </div>
          </>
        )}
        {plan && plan.items.length > 0 && <div className="mt-4"><Btn kind="soft" onClick={goPlan}>{c.myPlan} ({plan.items.length})</Btn></div>}
      </div>
    </main>
  );
}

export function PlanScreen({ c, back, goGuide }: { c: Copy; back: () => void; goGuide: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [hotel, setHotel] = useState<Guide['hotel']>(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const load = useCallback(() => { void api<Plan>('plan').then((r) => { if (r.ok) { setPlan(r.data); setSent(!!r.data.requested_at); } }); }, []);
  useEffect(() => { load(); void api<Guide>('guide').then((r) => { if (r.ok) setHotel(r.data.hotel); }); }, [load]);
  const remove = async (item: string) => { const r = await api<Plan>('plan/remove', { method: 'POST', body: JSON.stringify({ item }) }); if (r.ok) { setPlan(r.data); setSent(false); } };
  const send = async () => { setBusy(true); setErr(false); const r = await api('plan/send', { method: 'POST', idem: true, body: '{}' }); setBusy(false); if (r.ok) setSent(true); else setErr(true); };
  const text = (plan?.items ?? []).map((i, n) => `${n + 1}. ${i.when_label ? `${i.when_label} · ` : ''}${i.name}${mapsDirectionsUrl(hotel, { lat: i.lat, lng: i.lng, query: i.maps_query ?? i.name }) ? `\n   ${mapsDirectionsUrl(hotel, { lat: i.lat, lng: i.lng, query: i.maps_query ?? i.name })}` : ''}`).join('\n');
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: c.planTitle, text });
      else { await navigator.clipboard.writeText(text); setCopied(true); }
    } catch { /* cancelled */ }
  };
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} title={c.planTitle} />
      <div className="space-y-3 px-5">
        {plan && plan.items.length === 0 && <><p className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.planEmpty}</p><Btn onClick={goGuide}>{c.planOpen}</Btn></>}
        {plan && plan.items.length > 0 && (
          <>
            <ol className="space-y-2">{plan.items.map((i, n) => {
              const dir = mapsDirectionsUrl(hotel, { lat: i.lat, lng: i.lng, query: i.maps_query ?? i.name });
              return (
                <li key={i.id} className="flex items-start justify-between gap-3 rounded-2xl bg-white p-3 text-stone-900 shadow-sm">
                  <span><span className="font-extrabold">{n + 1}. {i.name}</span>{i.when_label && <span className="block text-sm">{i.when_label}</span>}
                    {dir && <a className="text-sm font-bold underline" href={dir} target="_blank" rel="noopener noreferrer">📍 {c.directions}</a>}</span>
                  <button type="button" onClick={() => void remove(i.id)} className="min-h-11 shrink-0 rounded-xl border-2 border-stone-300 px-3 text-sm font-semibold">{c.remove}</button>
                </li>
              );
            })}</ol>
            {sent ? <p role="status" className="rounded-2xl bg-white p-4 font-semibold text-stone-900 shadow-sm">{c.planSent}</p> : <Btn onClick={() => void send()} disabled={busy}>{busy ? c.sending : c.sendPlan}</Btn>}
            {err && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900">{c.failed}</p>}
            <Btn kind="soft" onClick={() => void share()}>{copied ? c.copied : c.sharePlan}</Btn>
            <Btn kind="soft" onClick={goGuide}>{c.planOpen}</Btn>
          </>
        )}
      </div>
    </main>
  );
}

interface Day { date: string; mode: 'in_house' | 'outdoor' | 'none'; name: string | null; start: string | null; end: string | null; venue: string | null; highlights: string | null; mood: string | null }

export function BuffetScreen({ c, back }: { c: Copy; back: () => void }) {
  const [d, setD] = useState<{ today: string; days: Day[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void api<{ today: string; days: Day[] }>('buffet').then((r) => { if (r.ok) setD(r.data); else setFailed(true); }); }, []);
  const label = (date: string, today: string) => {
    const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    return diff === 0 ? c.today : diff === 1 ? c.tomorrow : new Date(`${date}T00:00:00Z`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const tm = (t: string | null) => (t ? new Date(`1970-01-01T${t}:00Z`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : '');
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} title={c.buffetTitle} />
      <div className="space-y-3 px-5">
        <BuffetAlerts c={c} />
        {failed && <p role="alert" className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.failed}</p>}
        {d && d.days.length === 0 && <p className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.buffetEmpty}</p>}
        {d?.days.map((x) => (
          <article key={x.date} className="rounded-3xl bg-white p-4 text-stone-900 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#7a3a2e' }}>{label(x.date, d.today)}</p>
            {x.mode === 'none' ? <h2 className="text-lg font-extrabold">{c.noBuffet}</h2> : (
              <>
                <h2 className="text-lg font-extrabold">{x.name}</h2>
                <p className="font-semibold">{tm(x.start)} – {tm(x.end)}{x.venue ? ` · ${x.venue}` : ''}</p>
                <p className="text-sm" style={{ color: '#4a4f5a' }}>{x.mode === 'outdoor' ? c.outdoor : c.inHouse}</p>
                {x.highlights && <p className="mt-1">{x.highlights}</p>}
                {x.mood && <p className="mt-1 text-sm italic">{x.mood}</p>}
              </>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
