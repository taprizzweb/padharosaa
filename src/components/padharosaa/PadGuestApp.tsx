'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { POWERED_BY, instagramUrl } from '@/lib/brand';
import { FILTERS, SECTIONS, pickGroups, summaryHasMatch, toggleFilter, type CategorySummary, type Filter, type Section } from '@/lib/guest/filters';
import { buildTheme, themeVars } from '@/lib/padharosaa/theme';
import { COPY, LANGS, fill, isHelpLabel, localLabel, type Copy, type Lang } from './copy';
import { BuffetScreen, GuideScreen, PlanScreen } from './GuideScreens';
import { Btn, BrandPill, CookieNotice, Header, Hero, Icon, IconBox, PoweredPill, api, safeUrl, telHref, time, type IconName } from './shared';

interface Look { name: string; brand_color: string | null; logo_path: string | null; hero_path: string | null }
interface Home {
  offer: string | null; info: string | null; open_requests: number; look: Look;
  buffet: { set: boolean; mode?: string; name?: string; start?: string; end?: string; venue?: string };
  links: { instagram_url: string | null; google_review_url: string | null; tripadvisor_url: string | null; menu_url: string | null };
  contacts: { reception: string | null; manager: string | null };
}
const clock12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`; };
function ClosedBanner({ text }: { text: string | null }) { return text ? <p role="status" className="rounded-2xl p-3 text-sm font-semibold" style={{ background: '#FDF1D6', color: '#6b4308' }}>{text}</p> : null; }
/** The buffet is announced to every guest on the home screen the moment the desk or the manager sets it, with a "New" mark until the guest has looked. */
function BuffetNotice({ b, c, onOpen }: { b: Home['buffet']; c: Copy; onOpen: () => void }) {
  const sig = `${new Date().toDateString()}|${b.name ?? ''}|${b.start ?? ''}|${b.end ?? ''}|${b.venue ?? ''}`;
  const [fresh, setFresh] = useState(false);
  useEffect(() => { try { setFresh(localStorage.getItem('padh-buffet-seen') !== sig); } catch { setFresh(true); } }, [sig]);
  const open = () => { try { localStorage.setItem('padh-buffet-seen', sig); } catch { /* private mode */ } setFresh(false); onOpen(); };
  return (
    <button type="button" onClick={open} data-testid="buffet-notice" className="w-full rounded-[22px] p-4 text-left shadow-md" style={{ background: 'linear-gradient(135deg,#2f5d3a 0%,#3f7a4b 100%)', color: '#fff' }}>
      <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em]">● {c.buffet}{fresh && <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-green-900">{c.newTag}</span>}</span>
      <span className="mt-1.5 block text-base font-semibold leading-snug">{[b.name, b.start && b.end ? `${b.start}–${b.end}` : null, b.venue].filter(Boolean).join(' · ')}</span>
    </button>
  );
}
interface Me { name: string; room: string; language: string; hotel_name: string; slug?: string }
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
  const [hours, setHours] = useState<{ open: boolean; start: string | null; end: string | null } | null>(null);
  const c = COPY[lang];
  const [dine, setDine] = useState<{ room_dining: boolean } | null>(null);
  const [planCount, setPlanCount] = useState(0);
  useEffect(() => { if (screen.s === 'home') void api<{ items: unknown[] }>('plan').then((p) => { if (p.ok) setPlanCount(p.data.items.length); }); }, [screen.s]);
  const closed = hours && !hours.open ? (hours.start ? fill(c.closedNow, { at: clock12(hours.start) }) : c.closedNoTime) : null;

  const loadHours = useCallback(async () => { const r = await api<{ open: boolean; start: string | null; end: string | null }>('hours'); if (r.ok) setHours(r.data); }, []);
  useEffect(() => { void loadHours(); const t = setInterval(() => { if (!document.hidden) void loadHours(); }, 60_000); return () => clearInterval(t); }, [loadHours]);
  const loadHome = useCallback(async () => {
    const r = await api<Home>('home');
    if (r.ok) {
      setHome(r.data); void loadHours();
      void api<{ room_dining: boolean }>('dining').then((d) => { if (d.ok) setDine({ room_dining: d.data.room_dining }); });
      void api<{ items: unknown[] }>('plan').then((p) => { if (p.ok) setPlanCount(p.data.items.length); });
    }
    else if (r.status === 401 || r.status === 403) setMe(null);
  }, [loadHours]);

  useEffect(() => {
    void (async () => {
      const r = await api<Me>('sessions/me');
      // a login cookie left over from ANOTHER hotel must not open this hotel's page: show this hotel's own login instead
      if (r.ok && (!r.data.slug || r.data.slug === slug)) { setMe(r.data); setLang((LANGS.find((x) => x.code === r.data.language)?.code ?? 'en')); await loadHome(); } else setMe(null);
    })();
  }, [loadHome, slug]);

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
            {screen.s === 'home' && <HomeScreen me={me} home={home} c={c} closed={closed} dine={dine} planCount={planCount} go={setScreen} imageBase={imageBase} lang={lang} setLang={setLang} />}
            {screen.s === 'services' && <Services c={c} closed={closed} onClosed={() => void loadHours()} back={() => setScreen({ s: 'home' })} done={(id) => { void loadHome(); setScreen({ s: 'track', id }); }} />}
            {screen.s === 'guide' && <GuideScreen c={c} back={() => setScreen({ s: 'home' })} goPlan={() => setScreen({ s: 'plan' })} />}
            {screen.s === 'plan' && <PlanScreen c={c} back={() => setScreen({ s: 'home' })} goGuide={() => setScreen({ s: 'guide' })} />}
            {screen.s === 'buffet' && <BuffetScreen c={c} back={() => setScreen({ s: 'home' })} />}
            {screen.s === 'dining' && <DiningScreen c={c} back={() => setScreen({ s: 'home' })} />}
            {screen.s === 'help' && <HelpDialog c={c} closed={closed} onClosed={() => void loadHours()} close={() => setScreen({ s: 'home' })} done={(id) => { void loadHome(); setScreen({ s: 'track', id }); }} />}
            {screen.s === 'stay' && <Stay c={c} back={() => setScreen({ s: 'home' })} />}
            {screen.s === 'track' && <Track id={screen.id} c={c} links={home.links} phone={home.contacts.reception} retry={(label) => setScreen({ s: isHelpLabel(label) ? 'help' : 'services' })} back={() => { void loadHome(); setScreen({ s: 'home' }); }} />}
            <Footer home={home} c={c} />
          </>
        )}
      </div>
      <CookieNotice c={c} />
    </div>
  );
}

function Login({ slug, qrKey, c, lang, setLang, onDone, imageBase }: { slug: string; qrKey: string | null; c: Copy; lang: Lang; setLang: (l: Lang) => void; onDone: () => Promise<void>; imageBase: string }) {
  const [hotel, setHotel] = useState<{ name: string; brand_color: string | null; logo_path: string | null; hero_path?: string | null } | null>(null);
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
    if (r.ok) await onDone(); else setErr(r.key === 'unknown_room' || r.key === 'login_failed' || r.key === 'locked' || r.key === 'not_configured' ? r.key : 'failed');
  };
  const field = (k: 'name' | 'mobile' | 'room' | 'stay', label: string, props: { inputMode?: 'numeric' | 'tel'; maxLength?: number } = {}) => (
    <label className="block text-sm font-semibold">{label}
      <input className="mt-1 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-stone-900" style={{ borderColor: 'var(--tint)' }} {...props}
        onChange={(e) => { f.current[k] = e.target.value; force((n) => n + 1); }} />
    </label>
  );
  return (
    <main className="relative flex-1 pb-44" style={{ background: `linear-gradient(${t.gradient[0]}, ${t.gradient[1]} 18rem, var(--paper) 30rem)` }}>
      <Hero photo={hotel?.hero_path ? `${imageBase}${hotel.hero_path}` : null} />
      <div className="relative z-10 px-5 pb-4 pt-6" style={{ color: t.onHero }}>
        <BrandPill name={hotel?.name ?? ''} logo={hotel?.logo_path ? `${imageBase}${hotel.logo_path}` : null} />
        <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-tight" style={{ fontFamily: "Marcellus, 'Iowan Old Style', Georgia, serif", textShadow: '0 1px 12px rgba(60,20,12,.25)' }}>{hotel?.name || c.loginTitle}</h1>
        <p className="mt-1.5" style={{ color: t.onHeroSoft }}>{c.loginTitle}. {c.loginSub}</p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={c.language}>
          {LANGS.map(({ code, label }) => (
            <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)} className="min-h-11 rounded-full border px-4 text-sm font-semibold"
              style={lang === code ? { background: '#fff', color: '#5b4a40', borderColor: '#fff' } : { background: 'rgba(60,20,12,.32)', color: '#fff', borderColor: 'rgba(255,255,255,.55)' }}>{label}</button>
          ))}
        </div>
      </div>
      <form className="relative z-10 mx-4 space-y-3 rounded-3xl p-4 shadow-lg" onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ color: t.ink, background: 'rgba(255,255,255,.94)' }}>
        {field('name', c.name)}{field('mobile', c.mobile, { inputMode: 'tel', maxLength: 14 })}{field('room', c.roomNo, { maxLength: 10 })}{field('stay', c.stayCode, { inputMode: 'numeric', maxLength: 4 })}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" onChange={(e) => { f.current.consent = e.target.checked; }} />{c.consent}</label>
        {err && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900">{err === 'needKey' ? c.needKey : err === 'unknown_room' ? c.roomNotFound : err === 'login_failed' ? c.loginFailed : err === 'locked' ? c.tooManyTries : err === 'not_configured' ? c.notReady : c.failed}</p>}
        <button type="submit" disabled={busy || !hotel} style={{ background: t.button, color: t.onButton, boxShadow: `inset 0 0 0 2px ${t.buttonEdge}` }} className="min-h-12 w-full rounded-2xl px-4 py-3 text-base font-semibold disabled:opacity-60">{c.enter}</button>
      </form>
      <div className="relative z-10 mt-5 flex justify-center"><PoweredPill href={instagramUrl(POWERED_BY.instagram)} label={c.poweredBy} /></div>
    </main>
  );
}

function Tile({ icon, title, sub, onClick, big, wide }: { icon: IconName; title: string; sub?: string; onClick: () => void; big?: boolean; wide?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full flex-col items-center justify-center gap-2.5 rounded-3xl p-4 text-center shadow-sm transition active:scale-[0.97] ${big ? 'min-h-36' : 'min-h-28'} ${wide ? 'col-span-2' : ''}`}
      style={{ background: 'rgba(255,255,255,.94)', color: '#10131a' }}>
      <IconBox name={icon} />
      <span><span className={`block font-semibold ${big ? 'text-lg' : 'text-base'}`}>{title}</span>{sub && <span className="mt-0.5 block text-sm font-medium" style={{ color: '#4a4f5a' }}>{sub}</span>}</span>
    </button>
  );
}

function HomeScreen({ me, home, c, closed, dine, planCount, go, imageBase, lang, setLang }: { me: Me; home: Home; c: Copy; closed: string | null; dine: { room_dining: boolean } | null; planCount: number; go: (s: Screen) => void; imageBase: string; lang: Lang; setLang: (l: Lang) => void }) {
  const b = home.buffet;
  const buffetSub = !b.set ? c.buffetNotSet : b.mode === 'none' ? c.buffetNone : `${b.name ?? ''} ${b.start ?? ''}–${b.end ?? ''}`.trim();
  const logo = home.look.logo_path ? `${imageBase}${home.look.logo_path}` : null;
  const photo = home.look.hero_path ? `${imageBase}${home.look.hero_path}` : null;
  return (
    <main className="relative flex-1 pb-4" style={{ background: 'linear-gradient(180deg, var(--hero-0) 0, var(--hero-1) 15rem, var(--paper) 30rem)' }}>
      <Hero photo={photo} />
      <div className="relative z-10 space-y-3 px-5 pb-1 pt-6">
        <div className="flex items-center justify-between gap-3">
          <BrandPill name={home.look.name} logo={logo} />
          <select aria-label={c.language} value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="min-h-11 rounded-full border px-3 text-sm font-semibold" style={{ borderColor: 'rgba(255,255,255,.55)', background: 'rgba(60,20,12,.55)', color: '#fff' }}>{LANGS.map(({ code, label }) => <option key={code} value={code} style={{ color: '#10131a' }}>{label}</option>)}</select>
        </div>
        <div className="pb-1 pt-5" style={{ color: 'var(--on-hero)' }}>
          <h1 className="text-4xl font-semibold leading-[1.06] tracking-tight" style={{ textShadow: '0 1px 12px rgba(60,20,12,.25)' }}>{fill(c.hello, { name: me.name })}</h1>
          <p className="mt-2 text-base" style={{ color: 'var(--on-hero-soft)' }}>{fill(c.room, { room: me.room })}</p>
        </div>
        <ClosedBanner text={closed} />
        {home.offer && (
          <div className="rounded-[22px] p-4 text-white shadow-lg" style={{ background: 'linear-gradient(135deg,#8E1B2D 0%,#C42B45 60%,#B32A48 130%)' }}>
            <span className="text-[11px] font-bold uppercase tracking-[.16em] text-white/95">● {c.offerTag}</span>
            <p className="mt-1.5 whitespace-pre-line text-base font-semibold leading-snug">{home.offer}</p>
          </div>
        )}
        {b.set && b.mode !== 'none' && <BuffetNotice b={b} c={c} onOpen={() => go({ s: 'buffet' })} />}
        {home.info && (
          <div className="rounded-[22px] p-4 shadow-md" style={{ background: 'linear-gradient(140deg,#fff1b0 0%,#fcd34d 55%,#f0a020 135%)', color: '#3a2704' }}>
            <span className="text-[11px] font-bold uppercase tracking-[.16em]" style={{ color: 'rgba(88,56,4,.85)' }}>{c.infoTag}</span>
            <p className="mt-1.5 whitespace-pre-line text-base font-semibold leading-snug">{home.info}</p>
          </div>
        )}
      </div>
      <MyRequests c={c} open={(id) => go({ s: 'track', id })} />
      <div className="relative z-10 grid grid-cols-2 gap-3 px-5 pt-3">
        <Tile big wide icon="dining" title={c.dining} sub={dine && !dine.room_dining ? c.diningSubTakeaway : c.diningSub} onClick={() => go({ s: 'dining' })} />
        <Tile icon="services" title={c.services} onClick={() => go({ s: 'services' })} />
        <Tile icon="wifi" title={c.stay} onClick={() => go({ s: 'stay' })} />
        {b.set && <Tile icon="buffet" title={c.buffet} sub={buffetSub} onClick={() => go({ s: 'buffet' })} />}
        {planCount > 0 && <Tile icon="guide" title={c.planTile} sub={fill(c.planTileSub, { n: planCount })} onClick={() => go({ s: 'plan' })} />}
        <Tile icon="guide" title={c.guideTitle} sub={c.guideSub} onClick={() => go({ s: 'guide' })} />
      </div>
      <div className="relative z-10 px-5 pt-3">
        <button type="button" onClick={() => go({ s: 'help' })} className="flex min-h-[68px] w-full items-center gap-3.5 rounded-3xl p-3.5 text-left shadow-sm transition active:scale-[0.985]" style={{ background: '#F8EBCB', color: '#7a4e0a' }}>
          <IconBox name="help" bg="#8A5A0E" fg="#F8EBCB" size={40} />
          <span className="flex-1 font-semibold">{c.help}<span className="block text-sm font-medium">{c.helpSub}</span></span>
          <span aria-hidden className="text-xl">›</span>
        </button>
      </div>
      <Reviews home={home} c={c} />
    </main>
  );
}

interface MyReq { id: string; label: string; status: string; created_at: string }
/** The guest's own requests with their live status, so a reply from the team is always one tap away from the home screen. */
function MyRequests({ c, open }: { c: Copy; open: (id: string) => void }) {
  const [list, setList] = useState<MyReq[]>([]);
  const load = useCallback(async () => { const r = await api<{ requests: MyReq[] }>('requests'); if (r.ok) setList(r.data.requests.slice(0, 5)); }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 6000); return () => clearInterval(t); }, [load]);
  if (list.length === 0) return null;
  const word = (s: string) => (s === 'completed' ? c.done : s === 'dismissed' ? c.declined : s === 'cancelled' ? c.cancelled : s === 'received' ? c.sent : c.accepted);
  return (
    <section className="relative z-10 px-5 pt-3" aria-label={c.myRequests}>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--on-hero)' }}>{c.myRequests}</h2>
      <ul className="space-y-2">
        {list.map((q) => (
          <li key={q.id}>
            <button type="button" onClick={() => open(q.id)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-white p-3 text-left text-stone-900 shadow-sm">
              <span className="min-w-0"><span className="block truncate font-semibold">{localLabel(q.label, c)}</span><span className="block text-xs text-stone-600">{time(q.created_at)} · {c.seeAll}</span></span>
              <span className="shrink-0 rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'var(--tint)', color: 'var(--on-tint)' }}>{word(q.status)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reviews({ home, c }: { home: Home; c: Copy }) {
  const g = safeUrl(home.links.google_review_url), t = safeUrl(home.links.tripadvisor_url), ig = home.links.instagram_url ? safeUrl(home.links.instagram_url) : null;
  if (!g && !t && !ig) return null;
  const btn = 'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border bg-white px-3 text-sm font-bold text-stone-900 shadow-sm';
  const handle = ig ? `@${ig.replace(/\/+$/, '').split('/').pop() ?? ''}` : '';
  return (
    <section className="relative z-10 mx-5 mt-3 space-y-2.5 rounded-3xl p-4 shadow-sm" style={{ background: 'rgba(255,255,255,.94)', color: '#10131a' }}>
      {(g || t) && (<><h2 className="font-bold">{c.reviewTitle}</h2><p className="text-sm text-stone-600">{c.reviewSub}</p>
        <div className="flex gap-2">
          {g && <a className={btn} style={{ borderColor: '#e3cdb4' }} href={g} target="_blank" rel="noopener noreferrer"><b aria-hidden className="grid h-6 w-6 place-items-center rounded-full border bg-white text-[13px] text-[#1A5FD0]">G</b>{c.google}</a>}
          {t && <a className={btn} style={{ borderColor: '#e3cdb4' }} href={t} target="_blank" rel="noopener noreferrer"><IconBox name="owl" size={26} />{c.trip}</a>}
        </div></>)}
      {ig && (
        <a href={ig} target="_blank" rel="noopener noreferrer" className="flex min-h-[52px] items-center gap-3 rounded-2xl px-3.5 py-2 font-bold text-white" style={{ background: 'linear-gradient(135deg,#b45309,#be185d 55%,#6d28d9)' }}>
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/20"><Icon name="instagram" size={17} /></span>
          <span className="text-sm">{c.followHandle}<span className="block text-xs font-medium opacity-95">{handle}</span></span>
        </a>
      )}
    </section>
  );
}

function Footer({ home, c }: { home: Home; c: Copy }) {
  const ig = instagramUrl(POWERED_BY.instagram);
  const phone = home.contacts.reception;
  return (
    <>
      <div className="flex justify-center px-5 pb-3 pt-5"><PoweredPill href={ig} label={c.poweredBy} /></div>
      {phone && (
        <div className="sticky bottom-0 z-20 px-3 pb-3 pt-2" style={{ background: 'linear-gradient(transparent, var(--paper) 35%)' }}>
          <a href={telHref(phone)} className="flex min-h-12 items-center justify-center gap-2.5 rounded-2xl border-[1.5px] text-base font-bold shadow-sm" style={{ background: '#E2F1E7', color: '#1F6B3E', borderColor: '#1F6B3E' }}>
            <IconBox name="phone" bg="#1F6B3E" fg="#fff" size={28} />{c.call}
          </a>
        </div>
      )}
    </>
  );
}

/** A time of day the guest picks with the phone's own time picker (used for wake-up, cab pickup and late check-out). */
function TimePick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="block text-sm font-semibold">{label}<input type="time" value={value} onChange={(e) => onChange(e.target.value)} required className="mt-1 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-stone-900" /></label>;
}

function Services({ c, closed, onClosed, back, done }: { c: Copy; closed: string | null; onClosed: () => void; back: () => void; done: (id: string) => void }) {
  const [kind, setKind] = useState<'housekeeping' | 'wake' | 'cab' | 'late_checkout'>('housekeeping');
  const [label, setLabel] = useState<string>(c.hk[0]!);
  const [detail, setDetail] = useState('');
  const [when, setWhen] = useState('');
  const [dest, setDest] = useState('');
  const [car, setCar] = useState<string>(c.carTypes[0]!);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<null | 'failed' | 'time' | 'where'>(null);
  const kinds = ['housekeeping', 'wake', 'cab', 'late_checkout'] as const;
  const pick = (k: (typeof kinds)[number]) => { setKind(k); setErr(null); };
  const send = async () => {
    // each service asks for what the team needs, so reception never has to call the guest back
    if ((kind === 'wake' || kind === 'late_checkout' || kind === 'cab') && !when) { setErr('time'); return; }
    if (kind === 'cab' && dest.trim().length < 2) { setErr('where'); return; }
    const lines = kind === 'wake' ? [fill(c.wakeAt, { t: clock12(when) })]
      : kind === 'late_checkout' ? [fill(c.lateUntil, { t: clock12(when) })]
      : kind === 'cab' ? [fill(c.cabTo, { to: dest.trim() }), fill(c.cabAt, { t: clock12(when) }), fill(c.cabCar, { car })]
      : [];
    if (detail.trim()) lines.push(detail.trim());
    setBusy(true); setErr(null);
    const text = kind === 'housekeeping' ? `${c.types.housekeeping}: ${label}` : c.types[kind];
    const r = await api<{ id?: string; request_id?: string }>('requests', { method: 'POST', idem: true, body: JSON.stringify({ type: kind, label: text, ...(lines.length ? { detail: lines.join(' · ').slice(0, 500) } : {}), urgent: false }) });
    setBusy(false);
    const id = r.ok ? (r.data.id ?? r.data.request_id) : null;
    if (!r.ok && r.key === 'service_closed') onClosed();
    if (id) done(id); else setErr('failed');
  };
  const field = 'mt-1 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-stone-900';
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} title={c.services} />
      <div className="space-y-3 px-5">
        <div className="flex flex-wrap gap-2" role="group">
          {kinds.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => pick(k)} className="min-h-11 rounded-full border px-4 text-sm font-semibold"
              style={kind === k ? { background: 'var(--button)', color: 'var(--on-button)', borderColor: 'var(--ink)' } : { borderColor: 'var(--accent-text)', color: 'var(--ink)' }}>{c.types[k]}</button>
          ))}
        </div>
        {kind === 'housekeeping' && (
          <fieldset><legend className="mb-1 text-sm font-semibold">{c.hkLabel}</legend>
            {c.hk.map((h) => <label key={h} className="flex min-h-11 items-center gap-3"><input type="radio" name="hk" checked={label === h} onChange={() => setLabel(h)} className="h-5 w-5" />{h}</label>)}
          </fieldset>
        )}
        {kind === 'wake' && <TimePick label={c.wakeTime} value={when} onChange={setWhen} />}
        {kind === 'late_checkout' && <TimePick label={c.lateTime} value={when} onChange={setWhen} />}
        {kind === 'cab' && (
          <>
            <label className="block text-sm font-semibold">{c.cabWhere}<input value={dest} maxLength={120} onChange={(e) => setDest(e.target.value)} className={field} /></label>
            <TimePick label={c.cabTime} value={when} onChange={setWhen} />
            <label className="block text-sm font-semibold">{c.cabCarLabel}
              <select value={car} onChange={(e) => setCar(e.target.value)} className={field}>{c.carTypes.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          </>
        )}
        <label className="block text-sm font-semibold">{c.detail}<textarea maxLength={300} rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} className="mt-1 w-full rounded-xl border bg-white p-3 text-base text-stone-900" /></label>
        <ClosedBanner text={closed} />
        {err && !closed && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900">{err === 'time' ? c.needTime : err === 'where' ? c.needWhere : c.failed}</p>}
        <Btn onClick={() => void send()} disabled={busy || !!closed}>{busy ? c.sending : c.send}</Btn>
      </div>
    </main>
  );
}

function Stay({ c, back }: { c: Copy; back: () => void }) {
  const [s, setS] = useState<{ wifi_name: string | null; wifi_password: string | null; checkout_time: string | null; breakfast: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!s?.wifi_name) return;
    // the standard Wi-Fi code: a phone camera offers to join the network by itself
    const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
    const text = `WIFI:T:${s.wifi_password ? 'WPA' : 'nopass'};S:${esc(s.wifi_name)};${s.wifi_password ? `P:${esc(s.wifi_password)};` : ''};`;
    void import('qrcode').then((m) => m.toDataURL(text, { margin: 1, width: 240 })).then(setQr).catch(() => setQr(null));
  }, [s]);
  useEffect(() => { void api<NonNullable<typeof s>>('stay').then((r) => { if (r.ok) setS(r.data); }); }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(s?.wifi_password ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the password is shown, select it by hand */ } };
  const row = (k: string, v: string | null | undefined) => v ? <div className="flex justify-between gap-4 border-t py-3 first:border-t-0" style={{ borderColor: 'var(--tint)' }}><dt className="text-sm font-semibold text-stone-600">{k}</dt><dd className="text-right font-bold">{v}</dd></div> : null;
  return (
    <main className="flex-1 space-y-3 pb-4"><Header c={c} back={back} title={c.stay} />
      {(s?.wifi_name || s?.wifi_password) && (
        <div className="mx-5 flex items-center gap-3.5 rounded-3xl bg-white p-4 text-stone-900 shadow-sm">
          <IconBox name="wifi" />
          <div className="min-w-0 flex-1">
            {s.wifi_name && <><span className="block text-xs font-semibold text-stone-600">{c.wifiName}</span><b className="block truncate text-lg">{s.wifi_name}</b></>}
            {s.wifi_password && <><span className="mt-1 block text-xs font-semibold text-stone-600">{c.wifiPass}</span><b className="block select-all break-all font-mono text-lg">{s.wifi_password}</b></>}
          </div>
          {s.wifi_password && <button type="button" onClick={() => void copy()} className="min-h-11 rounded-full border-2 px-4 text-sm font-bold" style={{ borderColor: 'var(--accent-text)', color: 'var(--accent-text)' }}>{copied ? c.wifiCopied : c.wifiCopy}</button>}
        </div>
      )}
      {qr && (
        <div className="mx-5 rounded-3xl bg-white p-4 text-center text-stone-900 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={c.wifiQr} width={200} height={200} className="mx-auto" />
          <p className="mt-2 text-sm font-semibold">{c.wifiQr}</p>
        </div>
      )}
      <dl className="mx-5 rounded-3xl bg-white px-4 text-stone-900 shadow-sm">{row(c.checkout, s?.checkout_time)}{row(c.breakfast, s?.breakfast)}</dl>
      {s && !s.wifi_name && !s.wifi_password && !s.checkout_time && !s.breakfast && <p className="mx-5 rounded-3xl bg-white p-4 text-stone-900 shadow-sm">{c.buffetEmpty}</p>}
    </main>
  );
}

function Track({ id, c, back, links, phone, retry }: { id: string; c: Copy; back: () => void; links: Home['links']; phone: string | null; retry: (label: string) => void }) {
  const [v, setV] = useState<ReqView | null>(null);
  const load = useCallback(async () => { const r = await api<ReqView>(`requests/${id}`); if (r.ok) setV(r.data); }, [id]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(t); }, [load]);
  const q = v?.request;
  const declined = q?.status === 'dismissed', cancelled = q?.status === 'cancelled', finished = q?.status === 'completed';
  const headline = !q ? '…' : declined ? c.declined : cancelled ? c.cancelled : finished ? c.done : q.accepted_at ? c.accepted : c.sent;
  // a request the team could not take ends there: no "Done" step is left waiting
  const steps = declined ? [{ k: c.sent, at: q?.created_at ?? null, on: true }, { k: c.declined, at: null, on: true }] : [{ k: c.sent, at: q?.created_at ?? null, on: true }, { k: c.accepted, at: q?.accepted_at ?? null, on: !!q?.accepted_at }, { k: c.done, at: q?.completed_at ?? null, on: finished }];
  const confirm = async (ok: boolean) => { await api(`requests/${id}/confirm`, { method: 'POST', body: JSON.stringify({ ok }) }); await load(); };
  const cancel = async () => { await api(`requests/${id}/cancel`, { method: 'POST', body: '{}' }); await load(); };
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} title={headline} />
      <ol className="mx-5 space-y-3 rounded-3xl bg-white p-4 text-stone-900 shadow-sm" aria-label={headline}>
        {steps.map((s) => <li key={s.k} className="flex items-center justify-between gap-3"><span className="flex items-center gap-3"><span aria-hidden className="h-4 w-4 rounded-full" style={{ background: s.on ? (declined && s.k === c.declined ? '#b3261e' : '#1f6f43') : '#e5d8c8' }} /><span className={s.on ? 'font-bold' : 'text-stone-600'}>{s.k}</span></span><span className="text-sm text-stone-600">{time(s.at)}</span></li>)}
      </ol>
      {declined && q?.dismissed_reason && <p className="mx-5 mt-3 rounded-2xl bg-white p-4 text-stone-900 shadow-sm"><span className="block text-xs font-bold uppercase tracking-wide text-stone-600">{c.fromTeam}</span>{q.dismissed_reason}</p>}
      {declined && (
        <div className="mx-5 mt-3 space-y-2" data-testid="declined-actions">
          <p className="font-semibold">{c.declinedSorry}</p>
          <Btn onClick={() => retry(q?.label ?? '')}>{c.tryAgain}</Btn>
          {phone && <a href={telHref(phone)} className="flex min-h-12 items-center justify-center rounded-2xl border-2 text-base font-bold" style={{ borderColor: '#1F6B3E', color: '#1F6B3E', background: '#E2F1E7' }}>{c.call}</a>}
        </div>
      )}
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
function HelpDialog({ c, closed, onClosed, close, done }: { c: Copy; closed: string | null; onClosed: () => void; close: () => void; done: (id: string) => void }) {
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
    if (!r.ok && r.key === 'service_closed') onClosed();
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
        <ClosedBanner text={closed} />
        {err && !closed && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-900">{err === 'need' ? c.helpNeed : c.failed}</p>}
        <Btn onClick={() => void send()} disabled={busy || !!closed}>{busy ? c.sending : c.helpSend}</Btn>
      </div>
    </dialog>
  );
}

interface DiningData { available: boolean; room_dining: boolean; base?: string; chips?: ({ id: string; name: string } & CategorySummary)[] }

/** Dining: pick what you feel like (food type chips, then a section such as Food, Drinks or Bar, then the type of dish), and the restaurant's own menu opens already filtered, with your room filled in. */
function DiningScreen({ c, back }: { c: Copy; back: () => void }) {
  const [d, setD] = useState<DiningData | null>(null);
  const [failed, setFailed] = useState(false);
  const [sec, setSec] = useState<Set<Section>>(new Set());
  const [grp, setGrp] = useState<Set<string>>(new Set());
  const [diet, setDiet] = useState<Set<Filter>>(new Set());
  useEffect(() => { void api<DiningData>('dining').then((r) => { if (r.ok) setD(r.data); else setFailed(true); }); }, []);
  const flip = <T,>(set: Set<T>, k: T, put: (s: Set<T>) => void) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); put(n); };
  // Veg and Non-Veg are never on together; a category with no matching dish is hidden while Veg, Non-Veg or Bar is on (same rule as the menu itself)
  const chips = useMemo(() => (d?.chips ?? []).filter((k) => summaryHasMatch(k, diet)), [d, diet]);
  const groups = useMemo(() => pickGroups(chips.map((k) => ({ id: k.id, name: k.name }))), [chips]);
  const sections = SECTIONS.filter((x) => groups.some((g) => g.section === x));
  // the dish types of the chosen sections; with a single section on offer they show straight away
  const openSections = sections.length === 1 ? new Set<Section>(sections) : sec;
  const shownGroups = groups.filter((g) => openSections.has(g.section));
  const pickedIds = (): string[] => {
    const live = new Set(groups.map((g) => g.key));
    const chosen = [...grp].filter((k) => live.has(k));
    const fromGroups = groups.filter((g) => chosen.includes(g.key)).flatMap((g) => g.ids);
    if (fromGroups.length) return fromGroups;
    return groups.filter((g) => openSections.has(g.section) && sec.size > 0).flatMap((g) => g.ids);
  };
  const go = (filtered: boolean) => {
    if (!d?.base) return;
    const u = new URL(d.base);
    const ids = filtered ? pickedIds() : [];
    if (ids.length) u.searchParams.set('cats', ids.join(','));
    if (filtered && diet.size) u.searchParams.set('diet', [...diet].join(','));
    window.location.assign(u.toString());
  };
  const chip = (on: boolean) => on ? { background: 'var(--button)', color: 'var(--on-button)', borderColor: 'var(--ink)' } : { background: '#fff', color: '#10131a', borderColor: 'var(--accent-text)' };
  const pill = 'min-h-12 rounded-full border-2 px-4 text-base font-semibold';
  return (
    <main className="flex-1 pb-4">
      <Header c={c} back={back} title={c.dineTitle} />
      <div className="space-y-4 px-5">
        {failed || (d && !d.available) ? <p role="alert" className="rounded-2xl bg-white p-4 text-stone-900 shadow-sm">{c.dineNone}</p> : !d ? <p role="status">…</p> : (
          <>
            <p>{c.dineSub}</p>
            <fieldset><legend className="text-sm font-bold">{c.dineDiet}</legend>
              <div className="mt-2 flex flex-wrap gap-2">{FILTERS.map((k) => <button key={k} type="button" aria-pressed={diet.has(k)} onClick={() => setDiet(toggleFilter(diet, k))} className={pill} style={chip(diet.has(k))}>{diet.has(k) ? '✓ ' : ''}{c[k]}</button>)}</div>
            </fieldset>
            {sections.length > 1 && (
              <fieldset><legend className="text-sm font-bold">{c.dineSection}</legend>
                <div className="mt-2 flex flex-wrap gap-2">{sections.map((k) => <button key={k} type="button" aria-pressed={sec.has(k)} onClick={() => flip(sec, k, setSec)} className={pill} style={chip(sec.has(k))}>{sec.has(k) ? '✓ ' : ''}{c.sections[k]}</button>)}</div>
              </fieldset>
            )}
            {shownGroups.length > 0 && (
              <fieldset><legend className="text-sm font-bold">{c.dineType}</legend>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={c.dineType}>
                  {shownGroups.map((g) => <button key={g.key} type="button" aria-pressed={grp.has(g.key)} onClick={() => flip(grp, g.key, setGrp)} className={pill} style={chip(grp.has(g.key))}>{grp.has(g.key) ? '✓ ' : ''}{g.label}</button>)}
                </div>
              </fieldset>
            )}
            <p className="text-sm" style={{ opacity: 0.85 }}>{d.room_dining ? c.dineHow : c.dineTakeaway}</p>
            <Btn onClick={() => go(true)}>{c.showMenu}</Btn>
            {(sec.size > 0 || grp.size > 0 || diet.size > 0) && <Btn kind="soft" onClick={() => go(false)}>{c.fullMenu}</Btn>}
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
