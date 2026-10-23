'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { POWERED_BY, instagramUrl } from '@/lib/brand';
import { buildTheme, themeVars } from '@/lib/padharosaa/theme';
import { COPY, fill, type Copy, type Lang } from './copy';
import { BuffetScreen, GuideScreen, PlanScreen } from './GuideScreens';
import { Btn, CookieNotice, Header, api, safeUrl, telHref, time } from './shared';

interface Look { name: string; brand_color: string | null; logo_path: string | null; hero_path: string | null }
interface Home {
  offer: string | null; info: string | null; open_requests: number; look: Look;
  buffet: { set: boolean; mode?: string; name?: string; start?: string; end?: string; venue?: string };
  links: { instagram_url: string | null; google_review_url: string | null; tripadvisor_url: string | null; menu_url: string | null };
  contacts: { reception: string | null; manager: string | null };
}
interface Me { name: string; room: string; language: string; hotel_name: string }
interface ReqView {
  request: { id: string; label: string; status: string; dismissed_reason: string | null; created_at: string; accepted_at: string | null; completed_at: string | null; version: number; resolution: string | null; followup_asked: boolean };
  updates: { at: string; key: string; params: Record<string, string> | null }[];
}
type Screen = { s: 'home' } | { s: 'services' } | { s: 'stay' } | { s: 'help' } | { s: 'dining' } | { s: 'guide' } | { s: 'plan' } | { s: 'buffet' } | { s: 'track'; id: string };


export function PadGuestApp({ slug, qrKey, imageBase }: { slug: string; qrKey: string | null; imageBase: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [home, setHome] = useState<Home | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [screen, setScreen] = useState<Screen>({ s: 'home' });
  const c = COPY[lang];

  const loadHome = useCallback(async () => {
    const r = await api<Home>('home');
    if (r.ok) setHome(r.data);
    else if (r.status === 401 || r.status === 403) setMe(null);
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await api<Me>('sessions/me');
      if (r.ok) { setMe(r.data); setLang(r.data.language === 'hi' ? 'hi' : 'en'); await loadHome(); } else setMe(null);
    })();
  }, [loadHome]);

  const brand = home?.look.brand_color ?? null;
  const theme = useMemo(() => buildTheme(brand), [brand]);
  const style = themeVars(theme) as CSSProperties;

  return (
    <div style={{ ...style, background: 'var(--paper)', color: 'var(--ink)' }} className="min-h-dvh" lang={lang}>
      <div className="mx-auto flex min-h-dvh max-w-md flex-col">
        {me === undefined && <p className="p-8 text-center" role="status">…</p>}
        {me === null && <Login slug={slug} qrKey={qrKey} c={c} lang={lang} setLang={setLang} imageBase={imageBase} onDone={async () => { const r = await api<Me>('sessions/me'); if (r.ok) { setMe(r.data); await loadHome(); } }} />}
        {me && home && (
          <>
            {screen.s === 'home' && <HomeScreen me={me} home={home} c={c} go={setScreen} imageBase={imageBase} lang={lang} setLang={setLang} />}
            {screen.s === 'services' && <Services c={c} back={() => setScreen({ s: 'home' })} done={(id) => { void loadHome(); setScreen({ s: 'track', id }); }} />}
            {screen.s === 'guide' && <GuideScreen c={c} back={() => setScreen({ s: 'home' })} goPlan={() => setScreen({ s: 'plan' })} />}
            {screen.s === 'plan' && <PlanScreen c={c} back={() => setScreen({ s: 'home' })} goGuide={() => setScreen({ s: 'guide' })} />}
            {screen.s === 'buffet' && <BuffetScreen c={c} back={() => setScreen({ s: 'home' })} />}
            {screen.s === 'dining' && <DiningScreen c={c} back={() => setScreen({ s: 'home' })} />}
            {screen.s === 'help' && <HelpDialog c={c} close={() => setScreen({ s: 'home' })} done={(id) => { void loadHome(); setScreen({ s: 'track', id }); }} />}
            {screen.s === 'stay' && <Stay c={c} back={() => setScreen({ s: 'home' })} />}
            {screen.s === 'track' && <Track id={screen.id} c={c} links={home.links} back={() => { void loadHome(); setScreen({ s: 'home' }); }} />}
            <Footer home={home} c={c} />
          </>
        )}
      </div>
      <CookieNotice c={c} />
    </div>
  );
}

function Login({ slug, qrKey, c, lang, setLang, onDone, imageBase }: { slug: string; qrKey: string | null; c: Copy; lang: Lang; setLang: (l: Lang) => void; onDone: () => Promise<void>; imageBase: string }) {
  const [hotel, setHotel] = useState<{ name: string; brand_color: string | null; logo_path: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(qrKey ? null : 'needKey');
  const [busy, setBusy] = useState(false);
  const f = useRef({ name: '', mobile: '', room: '', stay: '', consent: false });
  const [, force] = useState(0);
  useEffect(() => {
    if (!qrKey) return;
    void api<typeof hotel>(`hotels/${slug}/public?k=${qrKey}`).then((r) => { if (r.ok) setHotel(r.data); else setErr('needKey'); });
  }, [slug, qrKey]);
  const t = buildTheme(hotel?.brand_color);
  const submit = async () => {
    if (!qrKey) return;
    setBusy(true); setErr(null);
    const v = f.current;
    const r = await api<{ ok: true }>(`hotels/${slug}/sessions`, {
      method: 'POST', idem: true,
      body: JSON.stringify({ k: qrKey, name: v.name, cc: '+91', mobile: v.mobile, language: lang, room: v.room, ...(v.stay ? { stay_code: v.stay } : {}), consent: v.consent, ...(v.consent ? { consent_version: 'v1' } : {}) }),
    });
    setBusy(false);
    if (r.ok) await onDone(); else setErr('failed');
  };
  const field = (k: 'name' | 'mobile' | 'room' | 'stay', label: string, props: { inputMode?: 'numeric' | 'tel'; maxLength?: number } = {}) => (
    <label className="block text-sm font-semibold">{label}
      <input className="mt-1 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-stone-900" style={{ borderColor: 'var(--tint)' }} {...props}
        onChange={(e) => { f.current[k] = e.target.value; force((n) => n + 1); }} />
    </label>
  );
  return (
    <main className="flex-1" style={{ background: `linear-gradient(${t.gradient[0]}, ${t.gradient[1]} 18rem, var(--paper) 30rem)` }}>
      <div className="px-5 pb-6 pt-8" style={{ color: t.onHero }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- own storage, tiny logo */}
        {hotel?.logo_path && <img src={`${imageBase}${hotel.logo_path}`} alt="" width={56} height={56} className="mb-3 h-14 w-14 rounded-2xl bg-white object-cover" />}
        <p className="text-sm font-semibold" style={{ color: t.onHeroSoft }}>{hotel?.name ?? ''}</p>
        <h1 className="text-3xl font-extrabold tracking-tight">{c.loginTitle}</h1>
        <p className="mt-1" style={{ color: t.onHeroSoft }}>{c.loginSub}</p>
        <div className="mt-3 flex gap-2" role="group" aria-label={c.language}>
          {(['en', 'hi'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className="min-h-11 rounded-full border px-4 text-sm font-semibold"
              style={lang === l ? { background: t.onHero, color: t.gradient[0], borderColor: t.onHero } : { color: t.onHero, borderColor: t.onHero }}>{l === 'en' ? 'English' : 'हिन्दी'}</button>
          ))}
        </div>
      </div>
      <form className="space-y-3 px-5 pb-8" onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ color: t.ink }}>
        {field('name', c.name)}{field('mobile', c.mobile, { inputMode: 'tel', maxLength: 14 })}{field('room', c.roomNo, { maxLength: 10 })}{field('stay', c.stayCode, { inputMode: 'numeric', maxLength: 4 })}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" onChange={(e) => { f.current.consent = e.target.checked; }} />{c.consent}</label>
        {err && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900">{err === 'needKey' ? c.needKey : c.failed}</p>}
        <button type="submit" disabled={busy || !hotel} style={{ background: t.button, color: t.onButton, boxShadow: `inset 0 0 0 2px ${t.buttonEdge}` }} className="min-h-12 w-full rounded-2xl px-4 py-3 text-base font-semibold disabled:opacity-60">{c.enter}</button>
      </form>
    </main>
  );
}

function Tile({ icon, title, sub, onClick, wide }: { icon: string; title: string; sub?: string; onClick: () => void; wide?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-h-28 w-full flex-col items-start justify-between rounded-3xl p-4 text-left shadow-sm transition active:scale-[0.98] ${wide ? 'col-span-2' : ''}`}
      style={{ background: 'rgba(255,255,255,0.92)', color: '#10131a' }}>
      <span aria-hidden className="text-2xl">{icon}</span>
      <span><span className="block text-base font-bold">{title}</span>{sub && <span className="block text-sm" style={{ color: '#4a4f5a' }}>{sub}</span>}</span>
    </button>
  );
}

function HomeScreen({ me, home, c, go, imageBase, lang, setLang }: { me: Me; home: Home; c: Copy; go: (s: Screen) => void; imageBase: string; lang: Lang; setLang: (l: Lang) => void }) {
  const b = home.buffet;
  const buffetSub = !b.set ? c.buffetNotSet : b.mode === 'none' ? c.buffetNone : `${b.name ?? ''} ${b.start ?? ''}–${b.end ?? ''}`.trim();
  return (
    <main className="flex-1 pb-4">
      <div className="px-5 pb-5 pt-6" style={{ background: `linear-gradient(var(--hero-0), var(--hero-1))`, color: 'var(--on-hero)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- own storage, tiny logo */}
            {home.look.logo_path && <img src={`${imageBase}${home.look.logo_path}`} alt="" width={40} height={40} className="h-10 w-10 rounded-xl bg-white object-cover" />}
            <span className="text-sm font-bold">{home.look.name}</span>
          </div>
          <button type="button" className="min-h-11 rounded-full border px-3 text-sm font-semibold" style={{ borderColor: 'var(--on-hero)' }} onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{lang === 'en' ? 'हिन्दी' : 'English'}</button>
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{fill(c.hello, { name: me.name })}</h1>
        <p style={{ color: 'var(--on-hero-soft)' }}>{fill(c.room, { room: me.room })}</p>
        {home.offer && <p className="mt-3 rounded-2xl p-3 text-sm font-semibold" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>{home.offer}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 pt-4">
        <Tile wide icon="🍽️" title={c.dining} sub={c.diningSub} onClick={() => go({ s: 'dining' })} />
        <Tile icon="🛎️" title={c.services} onClick={() => go({ s: 'services' })} />
        <Tile icon="📶" title={c.stay} onClick={() => go({ s: 'stay' })} />
        <Tile wide icon="🥞" title={c.buffet} sub={buffetSub} onClick={() => go({ s: 'buffet' })} />
        <Tile wide icon="🧭" title={c.guideTitle} sub={c.guideSub} onClick={() => go({ s: 'guide' })} />
      </div>
      <div className="px-5 pt-3"><Btn kind="soft" onClick={() => go({ s: 'help' })}>⚠️ {c.help} — {c.helpSub}</Btn></div>
      <Reviews home={home} c={c} />
    </main>
  );
}

function Reviews({ home, c }: { home: Home; c: Copy }) {
  const g = safeUrl(home.links.google_review_url), t = safeUrl(home.links.tripadvisor_url), ig = home.links.instagram_url ? safeUrl(home.links.instagram_url) : null;
  if (!g && !t && !ig) return null;
  const chip = 'flex min-h-12 flex-1 items-center justify-center rounded-xl border px-3 text-sm font-bold';
  return (
    <section className="mx-5 mt-4 rounded-3xl bg-white p-4 text-stone-900 shadow-sm">
      {(g || t) && (<><h2 className="font-bold">{c.reviewTitle}</h2><p className="text-sm text-stone-600">{c.reviewSub}</p>
        <div className="mt-3 flex gap-2">
          {g && <a className={chip} href={g} target="_blank" rel="noopener noreferrer">{c.google}</a>}
          {t && <a className={chip} href={t} target="_blank" rel="noopener noreferrer">{c.trip}</a>}
        </div></>)}
      {ig && <a href={ig} target="_blank" rel="noopener noreferrer" className="mt-3 flex min-h-12 items-center justify-center rounded-xl px-3 text-sm font-bold text-white" style={{ background: '#a1217a' }}>{c.follow}</a>}
    </section>
  );
}

function Footer({ home, c }: { home: Home; c: Copy }) {
  const ig = instagramUrl(POWERED_BY.instagram);
  const phone = home.contacts.reception;
  return (
    <footer className="sticky bottom-0 px-5 pb-3 pt-6" style={{ background: 'linear-gradient(transparent, var(--paper) 40%)' }}>
      {ig && <div className="mb-2 flex justify-center"><a href={ig} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-xs font-semibold text-stone-700 shadow-sm">{c.poweredBy}</a></div>}
      {phone && <a href={telHref(phone)} className="flex min-h-12 items-center justify-center rounded-2xl border-2 px-4 text-base font-bold" style={{ background: 'var(--tint)', color: 'var(--on-tint)', borderColor: 'var(--accent-text)' }}>📞 {c.call}</a>}
    </footer>
  );
}

function Services({ c, back, done }: { c: Copy; back: () => void; done: (id: string) => void }) {
  const [kind, setKind] = useState<'housekeeping' | 'wake' | 'cab' | 'late_checkout'>('housekeeping');
  const [label, setLabel] = useState<string>(c.hk[0]!);
  const [detail, setDetail] = useState('');
    const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const kinds = ['housekeeping', 'wake', 'cab', 'late_checkout'] as const;
  const send = async () => {
    setBusy(true); setErr(false);
    const text = kind === 'housekeeping' ? `${c.types.housekeeping}: ${label}` : c.types[kind as 'wake'];
    const r = await api<{ id?: string; request_id?: string }>('requests', { method: 'POST', idem: true, body: JSON.stringify({ type: kind, label: text, ...(detail.trim() ? { detail: detail.trim() } : {}), urgent: false }) });
    setBusy(false);
    const id = r.ok ? (r.data.id ?? r.data.request_id) : null;
    if (id) done(id); else setErr(true);
  };
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} sub={c.step1} title={c.services} />
      <div className="space-y-3 px-5">
        <div className="flex flex-wrap gap-2" role="group">
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className="min-h-11 rounded-full border px-4 text-sm font-semibold"
              style={kind === k ? { background: 'var(--button)', color: 'var(--on-button)', borderColor: 'var(--ink)' } : { borderColor: 'var(--accent-text)', color: 'var(--ink)' }}>{c.types[k]}</button>
          ))}
        </div>
        {kind === 'housekeeping' && (
          <fieldset><legend className="mb-1 text-sm font-semibold">{c.hkLabel}</legend>
            {c.hk.map((h) => <label key={h} className="flex min-h-11 items-center gap-3"><input type="radio" name="hk" checked={label === h} onChange={() => setLabel(h)} className="h-5 w-5" />{h}</label>)}
          </fieldset>
        )}
        <label className="block text-sm font-semibold">{c.detail}<textarea maxLength={500} rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-3 text-base text-stone-900" /></label>
        {err && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900">{c.failed}</p>}
        <Btn onClick={() => void send()} disabled={busy}>{busy ? c.sending : c.send}</Btn>
      </div>
    </main>
  );
}

function Stay({ c, back }: { c: Copy; back: () => void }) {
  const [s, setS] = useState<{ wifi_name: string | null; wifi_password: string | null; checkout_time: string | null; breakfast: string | null } | null>(null);
  useEffect(() => { void api<NonNullable<typeof s>>('stay').then((r) => { if (r.ok) setS(r.data); }); }, []);
  const row = (k: string, v: string | null | undefined) => v ? <div className="flex justify-between gap-4 border-b py-3" style={{ borderColor: 'var(--tint)' }}><dt className="text-sm font-semibold">{k}</dt><dd className="select-all text-right font-bold">{v}</dd></div> : null;
  return (
    <main className="flex-1 pb-4"><Header c={c} back={back} title={c.stay} />
      <dl className="mx-5 rounded-3xl bg-white px-4 text-stone-900 shadow-sm">{row(c.wifiName, s?.wifi_name)}{row(c.wifiPass, s?.wifi_password)}{row(c.checkout, s?.checkout_time)}{row(c.breakfast, s?.breakfast)}</dl>
    </main>
  );
}

function Track({ id, c, back, links }: { id: string; c: Copy; back: () => void; links: Home['links'] }) {
  const [v, setV] = useState<ReqView | null>(null);
  const load = useCallback(async () => { const r = await api<ReqView>(`requests/${id}`); if (r.ok) setV(r.data); }, [id]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(t); }, [load]);
  const q = v?.request;
  const declined = q?.status === 'dismissed', cancelled = q?.status === 'cancelled', finished = q?.status === 'completed';
  const headline = !q ? '…' : declined ? c.declined : cancelled ? c.cancelled : finished ? c.done : q.accepted_at ? c.accepted : c.sent;
  const steps = [{ k: c.sent, at: q?.created_at ?? null, on: true }, { k: declined ? c.declined : c.accepted, at: q?.accepted_at ?? null, on: !!q?.accepted_at || declined }, { k: c.done, at: q?.completed_at ?? null, on: finished }];
  const confirm = async (ok: boolean) => { await api(`requests/${id}/confirm`, { method: 'POST', body: JSON.stringify({ ok }) }); await load(); };
  const cancel = async () => { await api(`requests/${id}/cancel`, { method: 'POST', body: '{}' }); await load(); };
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} sub={c.step2} title={headline} />
      <ol className="mx-5 space-y-3 rounded-3xl bg-white p-4 text-stone-900 shadow-sm" aria-label={headline}>
        {steps.map((s) => <li key={s.k} className="flex items-center justify-between gap-3"><span className="flex items-center gap-3"><span aria-hidden className="h-4 w-4 rounded-full" style={{ background: s.on ? (declined && s.k === c.declined ? '#b3261e' : '#1f6f43') : '#e5d8c8' }} /><span className={s.on ? 'font-bold' : 'text-stone-600'}>{s.k}</span></span><span className="text-sm text-stone-600">{time(s.at)}</span></li>)}
      </ol>
      {declined && q?.dismissed_reason && <p className="mx-5 mt-3 rounded-2xl bg-white p-4 text-stone-900 shadow-sm"><span className="block text-xs font-bold uppercase tracking-wide text-stone-600">{c.fromTeam}</span>{q.dismissed_reason}</p>}
      {v && v.updates.length > 0 && (
        <section className="mx-5 mt-3" aria-label={c.updates}>
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--accent-text)' }}>{c.updates}</h2>
          <ul className="space-y-2">{v.updates.map((u, i) => <li key={i} className="flex gap-3 rounded-2xl bg-white p-3 text-sm text-stone-900 shadow-sm"><span className="shrink-0 text-stone-600">{time(u.at)}</span><span>{fill(c.upd[u.key] ?? u.key, { ...(u.params ?? {}), at: time((u.params as Record<string, string> | null)?.at ?? u.at) })}</span></li>)}</ul>
        </section>
      )}
      {finished && q?.resolution && !q.followup_asked && (
        <section className="mx-5 mt-3 rounded-2xl bg-white p-4 text-stone-900 shadow-sm"><p className="mb-3 font-bold">{c.ok}</p>
          <div className="grid grid-cols-2 gap-2"><Btn onClick={() => void confirm(true)}>{c.yes}</Btn><Btn kind="soft" onClick={() => void confirm(false)}>{c.no}</Btn></div></section>
      )}
      {finished && !q?.resolution && <Rate id={id} c={c} links={links} />}
      {q?.status === 'received' && <div className="mx-5 mt-4"><Btn kind="soft" onClick={() => void cancel()}>{c.cancel}</Btn></div>}
      <div className="mx-5 mt-4"><Btn onClick={back}>{c.home}</Btn></div>
    </main>
  );
}

const HELP_ORDER = ['towel_bedsheet', 'water', 'wifi', 'ac_electrical', 'tv', 'cleanliness', 'noise', 'other'] as const;

/** "Call for problems": a dialog over the home screen. Pick as many chips as apply, add a note if you like, send to reception. */
function HelpDialog({ c, close, done }: { c: Copy; close: () => void; done: (id: string) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<'need' | 'failed' | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const toggle = (k: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const send = async () => {
    if (picked.size === 0 && note.trim().length < 3) { setErr('need'); return; }
    setBusy(true); setErr(null);
    const r = await api<{ request_id?: string; id?: string }>('requests/help', { method: 'POST', idem: true, body: JSON.stringify({ categories: [...picked], ...(note.trim() ? { detail: note.trim() } : {}), urgent }) });
    setBusy(false);
    const id = r.ok ? (r.data.request_id ?? r.data.id) : null;
    if (id) done(id); else setErr('failed');
  };
  return (
    <dialog ref={ref} onClose={close} aria-labelledby="help-h" className="m-auto w-[min(28rem,calc(100vw-1.5rem))] max-h-[92dvh] overflow-y-auto rounded-3xl p-0 shadow-2xl backdrop:bg-black/50" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <div className="px-5 pb-4 pt-5" style={{ background: 'linear-gradient(var(--hero-0), var(--hero-1))', color: 'var(--on-hero)' }}>
        <div className="flex items-start justify-between gap-3"><h2 id="help-h" className="text-2xl font-extrabold tracking-tight">{c.helpTitle}</h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label={c.close} className="-mr-2 -mt-1 min-h-11 min-w-11 rounded-full text-2xl leading-none">×</button></div>
        <p className="mt-1" style={{ color: 'var(--on-hero-soft)' }}>{c.helpDlgSub}</p>
      </div>
      <div className="space-y-4 px-5 pb-5 pt-4">
        <fieldset>
          <legend className="text-sm font-bold">{c.helpLabel} <span className="font-medium" style={{ opacity: 0.75 }}>{c.helpTap}</span></legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {HELP_ORDER.map((k) => {
              const on = picked.has(k);
              return <button key={k} type="button" aria-pressed={on} onClick={() => toggle(k)} className="min-h-12 rounded-full border-2 px-4 text-base font-semibold"
                style={on ? { background: 'var(--button)', color: 'var(--on-button)', borderColor: 'var(--ink)' } : { background: '#fff', color: '#10131a', borderColor: 'var(--accent-text)' }}>{on ? '✓ ' : ''}{c.helpCats[k]}</button>;
            })}
          </div>
        </fieldset>
        <label className="block"><span className="block text-sm font-bold">{c.helpElse}</span><span className="block text-sm" style={{ opacity: 0.8 }}>{c.helpElseHint}</span>
          <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border-2 bg-white p-3 text-base text-stone-900" style={{ borderColor: 'var(--tint)' }} /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-5 w-5" />{c.urgent}</label>
        {err && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900">{err === 'need' ? c.helpNeed : c.failed}</p>}
        <Btn onClick={() => void send()} disabled={busy}>{busy ? c.sending : c.helpSend}</Btn>
      </div>
    </dialog>
  );
}

interface DiningData { available: boolean; room_dining: boolean; base?: string; chips?: { id: string; name: string }[] }

/** Dining: pick what you feel like (several categories, Veg / Jain), then the restaurant's own menu opens already filtered, with your room filled in. */
function DiningScreen({ c, back }: { c: Copy; back: () => void }) {
  const [d, setD] = useState<DiningData | null>(null);
  const [failed, setFailed] = useState(false);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [diet, setDiet] = useState<Set<string>>(new Set());
  useEffect(() => { void api<DiningData>('dining').then((r) => { if (r.ok) setD(r.data); else setFailed(true); }); }, []);
  const flip = (set: Set<string>, k: string, put: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); put(n); };
  const go = (filtered: boolean) => {
    if (!d?.base) return;
    const u = new URL(d.base);
    if (filtered && cats.size) u.searchParams.set('cats', [...cats].join(','));
    if (filtered && diet.size) u.searchParams.set('diet', [...diet].join(','));
    window.location.assign(u.toString());
  };
  const chip = (on: boolean) => on ? { background: 'var(--button)', color: 'var(--on-button)', borderColor: 'var(--ink)' } : { background: '#fff', color: '#10131a', borderColor: 'var(--accent-text)' };
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} title={c.dineTitle} />
      <div className="space-y-4 px-5">
        {failed || (d && !d.available) ? <p role="alert" className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.dineNone}</p> : !d ? <p role="status">…</p> : (
          <>
            <p>{c.dineSub}</p>
            <fieldset><legend className="text-sm font-bold">{c.dineDiet}</legend>
              <div className="mt-2 flex flex-wrap gap-2">{(['veg', 'jain'] as const).map((k) => <button key={k} type="button" aria-pressed={diet.has(k)} onClick={() => flip(diet, k, setDiet)} className="min-h-12 rounded-full border-2 px-4 text-base font-semibold" style={chip(diet.has(k))}>{diet.has(k) ? '✓ ' : ''}{c[k]}</button>)}</div>
            </fieldset>
            {(d.chips?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={c.dineTitle}>
                {d.chips!.map((k) => <button key={k.id} type="button" aria-pressed={cats.has(k.id)} onClick={() => flip(cats, k.id, setCats)} className="min-h-12 rounded-full border-2 px-4 text-base font-semibold" style={chip(cats.has(k.id))}>{cats.has(k.id) ? '✓ ' : ''}{k.name}</button>)}
              </div>
            )}
            <p className="text-sm" style={{ opacity: 0.85 }}>{d.room_dining ? c.dineHow : c.dineTakeaway}</p>
            <Btn onClick={() => go(true)}>{c.showMenu}</Btn>
            {(cats.size > 0 || diet.size > 0) && <Btn kind="soft" onClick={() => go(false)}>{c.fullMenu}</Btn>}
          </>
        )}
      </div>
    </main>
  );
}

/** "How was it?" after a request is done. A good answer offers Google and TripAdvisor equally (no pressure); a poor one goes to the manager. */
function Rate({ id, c, links }: { id: string; c: Copy; links: Home['links'] }) {
  const [done, setDone] = useState<null | { rating: string; invite: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const rate = async (rating: 'great' | 'okay' | 'not_good') => {
    setBusy(true);
    const r = await api<{ review_invite?: boolean }>(`requests/${id}/feedback`, { method: 'POST', body: JSON.stringify({ rating }) });
    setBusy(false);
    if (r.ok) setDone({ rating, invite: r.data.review_invite === true });
  };
  const g = safeUrl(links.google_review_url), t = safeUrl(links.tripadvisor_url);
  const chip = 'flex min-h-12 flex-1 items-center justify-center rounded-xl border-2 px-3 text-sm font-bold';
  return (
    <section className="mx-5 mt-3 rounded-2xl bg-white p-4 text-stone-900 shadow-sm" aria-live="polite">
      {!done ? (
        <>
          <p className="mb-3 font-bold">{c.rateTitle}</p>
          <div className="grid grid-cols-3 gap-2">
            {([['great', c.great, '😊'], ['okay', c.okay, '😐'], ['not_good', c.notGood, '😞']] as const).map(([k, label, e]) => (
              <button key={k} type="button" disabled={busy} onClick={() => void rate(k)} className="flex min-h-14 flex-col items-center justify-center rounded-xl border-2 border-stone-300 text-sm font-semibold"><span aria-hidden>{e}</span>{label}</button>
            ))}
          </div>
        </>
      ) : done.invite ? (
        <>
          <p className="font-bold">{c.rateReview}</p>
          <div className="mt-3 flex gap-2">
            {g && <a className={chip} style={{ borderColor: 'var(--accent-text)' }} href={g} target="_blank" rel="noopener noreferrer">{c.google}</a>}
            {t && <a className={chip} style={{ borderColor: 'var(--accent-text)' }} href={t} target="_blank" rel="noopener noreferrer">{c.trip}</a>}
          </div>
        </>
      ) : <p className="font-semibold">{done.rating === 'not_good' ? c.rateSorry : c.rateThanks}</p>}
    </section>
  );
}
