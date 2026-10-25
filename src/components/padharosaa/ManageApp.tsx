'use client';

import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ImageCropper } from '@/components/dash/ImageCropper';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ApiFailure } from '@/lib/guest/client';
import { AreaNav } from './AreaNav';
import { Overview } from './Overview';
import { ThemeToggle } from '@/components/ui/ns';
import { BuffetManager } from './BuffetManager';
import { GuideManager } from './GuideManager';
import { CheckoutPanel } from './CheckoutPanel';
import { GuestLinkPanel, RoomsCard, type LinkState } from './RoomsLink';
import { prettyPhone } from '@/lib/padharosaa/phone';
import { parseStaffCsv } from '@/lib/padharosaa/csv';
import { buildTheme, contrast, normaliseHex } from '@/lib/padharosaa/theme';

type Team = 'concierge' | 'front_desk' | 'housekeeping' | 'kitchen' | 'maintenance' | 'manager';
const TEAMS: [Team, string][] = [['front_desk', 'Front desk'], ['concierge', 'Concierge'], ['housekeeping', 'Housekeeping'], ['kitchen', 'Kitchen'], ['maintenance', 'Maintenance'], ['manager', 'Manager']];
interface Settings {
  brand_color: string | null; logo_path: string | null; hero_path: string | null; tripadvisor_url: string | null; menu_url: string | null; review_link: string | null;
  offer_text: string | null; offer_until: string | null; info_text: string | null; wifi_name: string | null; checkout_time: string | null; breakfast_text: string | null;
  reception_phone: string | null; manager_phone: string | null; room_dining: boolean; kitchen_display?: boolean; server_ready?: boolean; service_start?: string | null; service_end?: string | null; pay_qr_path?: string | null; auto_room_bill?: boolean;
}
interface Person { user_id: string; email: string; name: string; role: string; active: boolean; department: Team | null; whatsapp: string | null; is_head: boolean }
interface ImportResult { email: string; ok: boolean; error?: 'exists' | 'invalid' | 'failed' | string; temporary_password?: string }

const inputCls = 'mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900';
const btnCls = 'min-h-11 rounded-lg bg-indigo-900 px-5 text-sm font-semibold text-white disabled:opacity-50';

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="mt-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-base font-semibold tracking-tight">{title}</h2>{hint && <p className="text-sm text-stone-700">{hint}</p>}<div className="mt-3 space-y-3">{children}</div></section>;
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="block text-sm font-semibold">{label}{children}</label>;

export function ManageApp({ role, restaurant, supabase }: { role: string; restaurant: { id: string; name: string; slug: string }; supabase: { url: string; anonKey: string } }) {
  const sb = useMemo(() => createBrowserClient(supabase.url, supabase.anonKey), [supabase.url, supabase.anonKey]);
  const [s, setS] = useState<Settings | null>(null);
  const [insta, setInsta] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const [tab, setTab] = useState<'overview' | 'start' | 'hotel' | 'ops' | 'content' | 'team'>('overview');
  const [loadErr, setLoadErr] = useState<false | 'forbidden' | 'failed'>(false);
  const load = useCallback(async () => {
    try {
      const d = await apiGet<Settings & { instagram: string | null }>('/api/padharosaa/v1/staff/settings');
      setS(d); setInsta((d.instagram ?? '').replace(/^https:\/\/www\.instagram\.com\//, '@')); setLoadErr(false);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) { window.location.assign(`/login?next=/padharosaa/${role}`); return; } // the sign-in expired: sign in again, back to this console
      setLoadErr(e instanceof ApiFailure && e.status === 403 ? 'forbidden' : 'failed');
    }
  }, [role]);
  useEffect(() => { void load(); }, [load]);

  const save = async (path: string, body: unknown, done = 'Saved.') => {
    try { await apiPost(`/api/padharosaa/v1/staff/${path}`, body); flash(true, done); await load(); } catch (e) { flash(false, e instanceof ApiFailure && e.status === 400 ? 'That could not be saved. Please check the phone numbers (digits, like 9828114008) and the links (like https://...).' : 'That could not be saved. Please try again in a moment.'); }
  };

  if (!s) return <main className="p-8 text-center">{loadErr === 'forbidden' ? <p role="alert" className="mx-auto max-w-md font-semibold">This restaurant is not a Padharosaa hotel yet. Please ask Taprizz to switch Padharosaa on for it, then reload this page.</p> : loadErr ? <><p role="alert" className="font-semibold">The settings could not be loaded.</p><button type="button" className={btnCls + ' mt-3'} onClick={() => void load()}>Try again</button></> : 'Loading…'}</main>;
  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-stone-50 px-4 pb-24 pt-4 text-stone-900">
      <header className="flex items-start justify-between gap-3 border-b border-stone-200 pb-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-stone-500">{restaurant.name}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Manage Padharosaa</h1></div><ThemeToggle /></header>
      <AreaNav role={role} current={role === 'owner' ? 'owner' : 'manager'} kitchenDisplay={!!s.kitchen_display} />
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{msg.text}</p>}
      {s.server_ready === false && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">Guest sign-in is switched off: the setting PADHAROSAA_DATA_KEY is missing on the server. Add it in your hosting settings (Vercel → Environment Variables) and redeploy. Until then guests cannot enter.</p>}
      <div role="tablist" aria-label="Console sections" className="-mx-4 mt-4 flex gap-6 overflow-x-auto border-b border-stone-200 px-4">
        {([['overview', 'Overview'], ['start', 'Start'], ['hotel', 'Hotel'], ['ops', 'Orders & payment'], ['content', 'Buffet & guide'], ['team', 'Team']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px min-h-11 shrink-0 border-b-2 px-0.5 text-sm font-semibold ${tab === k ? 'border-indigo-900 text-indigo-950' : 'border-transparent text-stone-500'}`}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'start' && (
        <>
      <Checklist s={s} insta={insta} />
      <RoomsCard flash={flash} />
      <CheckoutPanel flash={flash} />
      <GuestLinkPanel slug={restaurant.slug} flash={flash} load={() => apiGet<LinkState>('/api/padharosaa/v1/staff/qr')} create={(password) => apiPost<{ link: string }>('/api/padharosaa/v1/staff/qr/rotate', { password })} />
        </>
      )}
      {tab === 'hotel' && (
        <>
      <HomeCard s={s} save={save} />
      <StayCard s={s} save={save} />
      <LookCard s={s} insta={insta} restaurantId={restaurant.id} sb={sb} save={save} />
        </>
      )}
      {tab === 'ops' && (
        <>
      <Card title="Room dining" hint="Switch off if your hotel does not serve food to rooms. Then 'Room delivery' is never offered, and the desk can only choose Takeaway.">
        <label className="flex min-h-11 items-center gap-3 font-semibold"><input type="checkbox" className="h-5 w-5" checked={s.room_dining} onChange={(e) => void save('dining', { room_dining: e.target.checked })} />Our hotel serves food to rooms</label>
        <label className="flex min-h-11 items-center gap-3 font-semibold"><input type="checkbox" className="h-5 w-5" checked={!!s.kitchen_display} onChange={(e) => void save('kitchen-display', { kitchen_display: e.target.checked })} />We have a separate kitchen display</label>
        <p className="text-sm text-stone-700">Everything always arrives at the reception desk first (every request and every food order). With a kitchen display, the kitchen also gets its own screen with the food orders.</p>
      </Card>
      <PayQrCard s={s} save={save} restaurantId={restaurant.id} sb={sb} />
      <AutoBillCard s={s} save={save} />
      <HoursCard s={s} save={save} />
      <RoutingCard flash={flash} />
        </>
      )}
      {tab === 'content' && (
        <>
      <BuffetManager flash={flash} />
      <GuideManager flash={flash} />
        </>
      )}
      {tab === 'team' && <><TeamCard canImport={role === 'owner'} flash={flash} /></>}
    </div>
  );
}

/** What a guest sees only appears once it is set here. Each line says what is missing and where to set it. */
function Checklist({ s, insta }: { s: Settings; insta: string }) {
  const items: [boolean, string][] = [
    [!!s.reception_phone, 'Reception phone, so guests get a Call reception button (Stay, Wi-Fi and phone numbers)'],
    [!!s.wifi_name, 'Wi-Fi name and password (Stay, Wi-Fi and phone numbers)'],
    [!!s.logo_path, 'Hotel logo (Colour, logo and links)'],
    [!!s.review_link, 'Google review link (Colour, logo and links)'],
    [!!s.tripadvisor_url, 'TripAdvisor link (Colour, logo and links)'],
    [!!insta.trim(), 'Instagram handle (Colour, logo and links)'],
  ];
  const todo = items.filter(([ok]) => !ok);
  if (todo.length === 0) return null;
  return (
    <Card title="Finish setup" hint="Guests only see what you fill in. These are still empty:">
      <ul className="space-y-1 text-sm">{todo.map(([, t]) => <li key={t} className="flex gap-2"><span aria-hidden>☐</span><span>{t}</span></li>)}</ul>
      <p className="text-sm text-stone-700">Requests from guests arrive on the desk board (<Link href="/padharosaa/desk" className="font-bold underline">open the desk</Link>). A guest sees the reply as soon as someone taps Accept there.</p>
    </Card>
  );
}

type Save = (path: string, body: unknown, done?: string) => Promise<void>;

/** The photo of the hotel's own payment (UPI) QR. A guest who taps "Pay now" on a room order sees this image. */
function PayQrCard({ s, save, restaurantId, sb }: { s: Settings; save: Save; restaurantId: string; sb: ReturnType<typeof createBrowserClient> }) {
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const imageBase = sb.storage.from('menu-images').getPublicUrl('x').data.publicUrl.replace(/x$/, '');
  const url = s.pay_qr_path ? `${imageBase}${s.pay_qr_path}` : null;
  const upload = async (file: File) => {
    setBusy(true); setBad(false);
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${restaurantId}/payqr-${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('menu-images').upload(path, file, { contentType: file.type, upsert: false });
    if (error) setBad(true); else await save('pay-qr', { path }, 'Payment QR saved.');
    setBusy(false);
  };
  return (
    <Card title="Payment QR for guests" hint="Upload a photo of your hotel's payment (UPI) QR code. After a room order the guest can choose Add to room receipt or Pay now. Pay now shows this QR. Without it, only Add to room receipt is offered. Photos up to 20 MB.">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="Your payment QR" className="my-1 max-h-56 rounded-lg border border-stone-300 bg-white object-contain p-2" />}
      <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose the payment QR photo" disabled={busy} className="block min-h-11 w-full text-base" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      {bad && <p role="alert" className="text-sm font-semibold text-red-900">The photo could not be uploaded. Please try a smaller JPG or PNG.</p>}
      {url && <button type="button" className="min-h-11 text-sm font-semibold underline" onClick={() => void save('pay-qr', { path: null }, 'Payment QR removed.')}>Remove the QR</button>}
    </Card>
  );
}

/** Room food orders go on the room receipt by themselves; the guest can still switch an order to Pay now. */
function AutoBillCard({ s, save }: { s: Settings; save: Save }) {
  return (
    <Card title="Bill room orders to the room automatically" hint="When this is on, every food order from a room is added to that room's receipt as soon as it is placed. The guest is not asked, and can still choose Pay now on the order screen if you have a payment QR. Amounts are shown without GST and service charges.">
      <label className="flex min-h-11 items-center gap-3 text-base font-semibold"><input type="checkbox" className="size-5" checked={!!s.auto_room_bill} onChange={(e) => void save('auto-bill', { on: e.target.checked }, e.target.checked ? 'Room orders are now billed to the room automatically.' : 'Guests will be asked how to pay.')} />Bill to the room automatically</label>
    </Card>
  );
}

/** Who gets each team's requests straight on their own display, without reception handing them over. */
function RoutingCard({ flash }: { flash: (ok: boolean, text: string) => void }) {
  const [people, setPeople] = useState<{ user_id: string; name: string; department: string | null }[]>([]);
  const [routing, setRouting] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([apiGet<{ people: typeof people }>('/api/padharosaa/v1/staff/assignees'), apiGet<{ routing: Record<string, string> }>('/api/padharosaa/v1/staff/routing')]);
      setPeople(p.people); setRouting(r.routing);
    } catch { /* the card simply stays empty */ }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const set = async (team: Team, user: string) => {
    try { await apiPost('/api/padharosaa/v1/staff/routing', { team, user: user || null }); flash(true, user ? 'Saved. New requests of this team now go straight to that person.' : 'Saved. This team shares its requests again.'); await load(); } catch { flash(false, 'That could not be saved. Please try again.'); }
  };
  return (
    <Card title="Who gets which requests" hint="Choose a person for a team and every new request of that team appears directly on that person's own screen (reception, manager and owner still see it and can hand it to someone else). Leave it empty and the whole team shares the requests.">
      <div className="space-y-2">
        {TEAMS.map(([t, name]) => (
          <label key={t} className="block text-sm font-semibold">{name}
            <select value={routing[t] ?? ''} onChange={(e) => void set(t, e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900">
              <option value="">Everyone in the team</option>
              {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}{p.department ? ` · ${p.department.replace('_', ' ')}` : ''}</option>)}
            </select>
          </label>
        ))}
      </div>
    </Card>
  );
}

function HoursCard({ s, save }: { s: Settings; save: Save }) {
  const [f, setF] = useState({ start: s.service_start ?? '', end: s.service_end ?? '' });
  const set = !!(s.service_start && s.service_end);
  return (
    <Card title="Opening and closing time for requests" hint="Guests can send requests (help, services, food orders to the room) only between these times. After closing, nothing reaches the desk until the next opening time. Leave both empty to take requests all day and night. Asking for the bill is always possible.">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Starts at"><input type="time" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="Closes at"><input type="time" className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      </div>
      <p className="text-sm text-stone-700">{set ? `Right now guests can send requests from ${s.service_start} to ${s.service_end}.` : 'Right now requests are taken all day and night.'} A time like 18:00 to 02:00 (past midnight) works too.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnCls} disabled={!f.start || !f.end || f.start === f.end} onClick={() => void save('hours', { start: f.start, end: f.end }, 'Hours saved.')}>Save hours</button>
        {set && <button type="button" className={btnCls} onClick={() => { setF({ start: '', end: '' }); void save('hours', { start: null, end: null }, 'Requests are open all day again.'); }}>Open all day</button>}
      </div>
    </Card>
  );
}

function HomeCard({ s, save }: { s: Settings; save: Save }) {
  const [f, setF] = useState({ offer: s.offer_text ?? '', until: s.offer_until ? s.offer_until.slice(0, 16) : '', info: s.info_text ?? '' });
  return (
    <Card title="Guest home texts" hint="The offer box shows until the time you set (max 7 days). The info box shows until you clear it.">
      <Field label="Offer (e.g. Free lassi with dinner tonight)"><input className={inputCls} maxLength={200} value={f.offer} onChange={(e) => setF({ ...f, offer: e.target.value })} /></Field>
      <Field label="Offer ends"><input type="datetime-local" className={inputCls} value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field>
      <Field label="Info (e.g. Pool closed 1 to 3 PM)"><input className={inputCls} maxLength={400} value={f.info} onChange={(e) => setF({ ...f, info: e.target.value })} /></Field>
      <button type="button" className={btnCls} onClick={() => void save('home', { offer: f.offer || null, offer_until: f.offer && f.until ? new Date(f.until).toISOString() : null, info: f.info || null })}>Save texts</button>
    </Card>
  );
}

function StayCard({ s, save }: { s: Settings; save: Save }) {
  const [f, setF] = useState({ wifi: s.wifi_name ?? '', pass: '', out: s.checkout_time ?? '', bf: s.breakfast_text ?? '', rec: prettyPhone(s.reception_phone), mgr: prettyPhone(s.manager_phone) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Stay, Wi-Fi and phone numbers" hint="The reception number appears as the always-visible Call reception button. Leave the password empty to keep the current one.">
      <Field label="Wi-Fi name"><input className={inputCls} maxLength={60} value={f.wifi} onChange={set('wifi')} /></Field>
      <Field label="Wi-Fi password (never shown again)"><input type="password" autoComplete="new-password" className={inputCls} maxLength={63} value={f.pass} onChange={set('pass')} /></Field>
      <Field label="Check-out time"><input className={inputCls} maxLength={40} value={f.out} onChange={set('out')} /></Field>
      <Field label="Breakfast"><input className={inputCls} maxLength={80} value={f.bf} onChange={set('bf')} /></Field>
      <Field label="Reception phone (e.g. 9828114008)"><input inputMode="tel" className={inputCls} value={f.rec} onChange={set('rec')} /></Field>
      <Field label="Manager phone"><input inputMode="tel" className={inputCls} value={f.mgr} onChange={set('mgr')} /></Field>
      <button type="button" className={btnCls} onClick={() => void save('stay', { wifi_name: f.wifi || null, wifi_password: f.pass || null, checkout_time: f.out || null, breakfast: f.bf || null, reception_phone: f.rec || null, manager_phone: f.mgr || null })}>Save stay info</button>
    </Card>
  );
}

function LookCard({ s, insta, restaurantId, sb, save }: { s: Settings; insta: string; restaurantId: string; sb: ReturnType<typeof createBrowserClient>; save: Save }) {
  const [f, setF] = useState({ color: s.brand_color ?? '#b05545', ig: insta, google: s.review_link ?? '', trip: s.tripadvisor_url ?? '', menu: s.menu_url ?? '', logo: s.logo_path ?? '', hero: s.hero_path ?? '' });
  const [cropping, setCropping] = useState<{ kind: 'logo' | 'hero'; file: File } | null>(null);
  const [upErr, setUpErr] = useState(false);
  const t = buildTheme(f.color);
  const imageBase = `${sb.storage.from('menu-images').getPublicUrl('x').data.publicUrl.replace(/x$/, '')}`;
  const upload = async (kind: 'logo' | 'hero', blob: Blob) => {
    setUpErr(false);
    const path = `${restaurantId}/${crypto.randomUUID()}.webp`;
    const { error } = await sb.storage.from('menu-images').upload(path, blob, { contentType: 'image/webp', upsert: false });
    if (error) setUpErr(true); else setF((x) => ({ ...x, [kind]: path }));
  };
  const pick = (kind: 'logo' | 'hero', label: string) => (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {f[kind] && <img src={`${imageBase}${f[kind]}`} alt="" className="my-1 h-20 rounded-lg bg-stone-100 object-cover" />}
      <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Choose ${label.toLowerCase()}`} className="block min-h-11 w-full text-base" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setCropping({ kind, file }); }} />
      {f[kind] && <button type="button" className="min-h-11 text-sm font-semibold underline" onClick={() => setF({ ...f, [kind]: '' })}>Remove</button>}
    </div>
  );
  return (
    <Card title="Colour, logo and links" hint="Pick any colour, light or dark. Text and buttons adjust by themselves so they stay readable.">
      <Field label="Brand colour"><div className="mt-1 flex items-center gap-3"><input type="color" aria-label="Pick colour" className="h-12 w-16 rounded-lg" value={normaliseHex(f.color)} onChange={(e) => setF({ ...f, color: e.target.value })} /><input className={inputCls + ' !mt-0'} value={f.color} maxLength={7} onChange={(e) => setF({ ...f, color: e.target.value })} /></div></Field>
      <div className="rounded-2xl p-4" style={{ background: `linear-gradient(${t.gradient[0]}, ${t.gradient[1]})`, color: t.onHero }} aria-label="Preview">
        <p className="text-lg font-extrabold">Namaste, Anita</p><p className="text-sm" style={{ color: t.onHeroSoft }}>Room 204 · What would you like?</p>
        <span className="mt-2 inline-block rounded-xl px-4 py-2 text-sm font-bold" style={{ background: t.button, color: t.onButton }}>Send request</span>
        <p className="mt-2 text-xs">Text contrast {contrast(t.onHero, t.gradient[0]).toFixed(1)}:1 · button {contrast(t.onButton, t.button).toFixed(1)}:1 (4.5 or more is easy to read)</p>
      </div>
      {pick('logo', 'Logo (top of the guest screen)')}
      {pick('hero', 'Hero photo')}
      {upErr && <p role="alert" className="text-sm font-semibold text-red-900">The picture could not be uploaded. Please try again.</p>}
      <Field label="Instagram handle"><input className={inputCls} placeholder="@yourhotel" maxLength={31} value={f.ig} onChange={(e) => setF({ ...f, ig: e.target.value })} /></Field>
      <Field label="Google review link (https)"><input className={inputCls} value={f.google} onChange={(e) => setF({ ...f, google: e.target.value })} /></Field>
      <Field label="TripAdvisor review link (https)"><input className={inputCls} value={f.trip} onChange={(e) => setF({ ...f, trip: e.target.value })} /></Field>
      <Field label="Menu link for Dining (the restaurant's room-service link; leave empty to use this hotel's own menu)"><input className={inputCls} placeholder="https://menu.taprizz.in/…" value={f.menu} onChange={(e) => setF({ ...f, menu: e.target.value })} /></Field>
      <button type="button" className={btnCls} onClick={() => void save('branding', { brand_color: normaliseHex(f.color), logo_path: f.logo || null, logo_crop: null, hero_path: f.hero || null, hero_crop: null, instagram: f.ig || null, google_review_url: f.google || null, tripadvisor_url: f.trip || null, menu_url: f.menu || null })}>Save look and links</button>
      {cropping && <ImageCropper file={cropping.file} aspect={cropping.kind === 'logo' ? 1 : 3 / 2} outWidth={cropping.kind === 'logo' ? 512 : 1600} title={cropping.kind === 'logo' ? 'Crop the logo' : 'Crop the hero photo'} onCancel={() => setCropping(null)} onDone={(blob) => { const k = cropping.kind; setCropping(null); void upload(k, blob); }} />}
    </Card>
  );
}

function TeamCard({ canImport, flash }: { canImport: boolean; flash: (ok: boolean, t: string) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [csv, setCsv] = useState('');
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ name: string; email: string; password: string } | null>(null);
  const [fixing, setFixing] = useState<{ id: string; email: string } | null>(null);
  const [one, setOne] = useState({ name: '', email: '', department: 'front_desk' as Team, whatsapp: '', head: false });
  const load = useCallback(async () => { try { setPeople((await apiGet<{ staff: Person[] }>('/api/padharosaa/v1/staff/team')).staff); } catch { setPeople([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  const setProfile = async (p: Person, patch: Partial<Person>) => {
    const n = { ...p, ...patch };
    try { await apiPost(`/api/padharosaa/v1/staff/team/${p.user_id}`, { department: n.department ?? 'front_desk', whatsapp: n.whatsapp || null, is_head: n.is_head }); await load(); } catch { flash(false, 'Could not save. Use the number format +91 98765 43210.'); }
  };
  const resetPassword = async (p: Person) => {
    if (!window.confirm(`Give ${p.name} a new one-time password? Their old password stops working at once.`)) return;
    try { const r = await apiPost<{ temporary_password: string }>(`/api/padharosaa/v1/staff/team/${p.user_id}/account`, { action: 'reset' }); setShown({ name: p.name, email: p.email, password: r.temporary_password }); } catch { flash(false, 'The password could not be reset. Please try again.'); }
  };
  const changeEmail = async (p: Person, email: string) => {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) { flash(false, 'Please type a correct email.'); return; }
    try { await apiPost(`/api/padharosaa/v1/staff/team/${p.user_id}/account`, { action: 'email', email: e }); setFixing(null); flash(true, `${p.name} now signs in with ${e}. Their password stays the same.`); await load(); }
    catch (err) { flash(false, err instanceof ApiFailure && err.status === 409 ? 'That email already has a login.' : 'The email could not be changed. Please try again.'); }
  };
  const doImport = async () => {
    const { rows, bad } = parseStaffCsv(csv);
    if (!rows.length) { flash(false, 'No valid rows. Use: name, email, department, whatsapp, head (yes/no).'); return; }
    setBusy(true);
    try { setResults((await apiPost<{ results: ImportResult[] }>('/api/padharosaa/v1/staff/team/import', { rows })).results); if (bad) flash(false, `${bad} row(s) were skipped because they were not valid.`); await load(); }
    catch { flash(false, 'The import did not go through. Please check the rows and try again.'); }
    setBusy(false);
  };
  const addOne = async () => {
    const rows = [{ name: one.name.trim(), email: one.email.trim(), department: one.department, whatsapp: one.whatsapp.trim() || null, is_head: one.head }];
    if (!rows[0]!.name || !/^\S+@\S+\.\S+$/.test(rows[0]!.email)) { flash(false, 'Please type the name and a correct email.'); return; }
    setBusy(true);
    try {
      const r = (await apiPost<{ results: ImportResult[] }>('/api/padharosaa/v1/staff/team/import', { rows })).results;
      setResults(r);
      if (r[0]?.ok) { setOne({ name: '', email: '', department: one.department, whatsapp: '', head: false }); flash(true, `${rows[0]!.name} can now sign in. Their one-time password is below.`); } else flash(false, r[0]?.error === 'exists' ? 'That email already has a login.' : r[0]?.error === 'invalid' ? 'That person could not be added. Please check the WhatsApp number (like 9828114008) and the team.' : 'That person could not be added. Please try again in a moment.');
      await load();
    } catch { flash(false, 'The person could not be added. Please check the details.'); }
    setBusy(false);
  };
  const download = () => {
    const body = ['email,temporary_password,status', ...(results ?? []).map((r) => `${r.email},${r.temporary_password ?? ''},${r.ok ? 'created' : r.error}`)].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'new-staff-logins.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <Card title="Team" hint="Set each person's department and WhatsApp number. The head of a department gets the WhatsApp when a guest reports a problem for that department. Passwords are never shown here, but the owner can give anyone a new one-time password or correct their email.">
      {shown && (
        <div className="rounded-xl bg-amber-50 p-3" role="status">
          <p className="text-sm font-bold">New one-time password for {shown.name} ({shown.email}). It is shown only once; they must change it when they sign in.</p>
          <p className="mt-1 text-lg"><code>{shown.password}</code></p>
          <button type="button" className={btnCls + ' mt-2'} onClick={() => setShown(null)}>Done</button>
        </div>
      )}
      {people?.length === 0 && <p className="text-sm text-stone-700">No team members yet.</p>}
      <ul className="space-y-3">
        {(people ?? []).map((p) => (
          <li key={p.user_id} className="rounded-xl border-2 border-stone-200 p-3">
            <p className="font-bold">{p.name} <span className="text-sm font-normal text-stone-700">· {p.email} · {p.role}{p.active ? '' : ' · inactive'}</span></p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <select aria-label={`Department for ${p.name}`} className={inputCls + ' !mt-0'} value={p.department ?? ''} onChange={(e) => void setProfile(p, { department: e.target.value as Team })}><option value="" disabled>Department…</option>{TEAMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input aria-label={`WhatsApp for ${p.name}`} inputMode="tel" placeholder="+91 98765 43210" defaultValue={p.whatsapp ?? ''} className={inputCls + ' !mt-0'} onBlur={(e) => { if (e.target.value !== (p.whatsapp ?? '') && p.department) void setProfile(p, { whatsapp: e.target.value }); }} />
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={p.is_head} disabled={!p.department} onChange={(e) => void setProfile(p, { is_head: e.target.checked })} />Department head</label>
            </div>
            {canImport && p.role !== 'owner' && (
              <div className="mt-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnCls} onClick={() => void resetPassword(p)}>Reset password</button>
                  <button type="button" className={btnCls} onClick={() => setFixing(fixing?.id === p.user_id ? null : { id: p.user_id, email: p.email })}>Change email</button>
                </div>
                {fixing?.id === p.user_id && (
                  <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void changeEmail(p, fixing.email); }}>
                    <Field label={`New email for ${p.name}`}><input type="email" inputMode="email" autoComplete="off" className={inputCls} value={fixing.email} maxLength={120} onChange={(e) => setFixing({ id: p.user_id, email: e.target.value })} /></Field>
                    <button type="submit" className={btnCls}>Save email</button>
                  </form>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canImport && (
        <form className="rounded-xl bg-stone-50 p-3" onSubmit={(e) => { e.preventDefault(); void addOne(); }}>
          <h3 className="font-bold">Add one person</h3>
          <p className="text-sm text-stone-700">They get their own login. After signing in at <code>padharosaa.taprizz.in/login</code> each person lands on their own page.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Name"><input className={inputCls} value={one.name} maxLength={80} onChange={(e) => setOne({ ...one, name: e.target.value })} /></Field>
            <Field label="Email"><input type="email" inputMode="email" autoComplete="off" className={inputCls} value={one.email} maxLength={254} onChange={(e) => setOne({ ...one, email: e.target.value })} /></Field>
            <Field label="Team (their page)">
              <select className={inputCls} value={one.department} onChange={(e) => setOne({ ...one, department: e.target.value as Team })}>
                <option value="front_desk">Reception (/reception)</option><option value="concierge">Concierge (/reception)</option><option value="housekeeping">Housekeeping (/housekeeping)</option>
                <option value="maintenance">Maintenance (/housekeeping)</option><option value="kitchen">Kitchen (/kitchen)</option><option value="manager">Manager (/manager)</option>
              </select>
            </Field>
            <Field label="WhatsApp (optional, for alerts)"><input inputMode="tel" className={inputCls} placeholder="+91 98765 43210" value={one.whatsapp} onChange={(e) => setOne({ ...one, whatsapp: e.target.value })} /></Field>
          </div>
          <label className="mt-2 flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={one.head} onChange={(e) => setOne({ ...one, head: e.target.checked })} />Head of this team (gets the WhatsApp alerts)</label>
          <button type="submit" disabled={busy} className={btnCls + ' mt-2'}>{busy ? 'Adding…' : 'Add person'}</button>
        </form>
      )}
      {canImport && (
        <div className="rounded-xl bg-stone-50 p-3">
          <h3 className="font-bold">Add many people (CSV)</h3>
          <p className="text-sm text-stone-700">One person per line: <code>name, email, department, whatsapp, head</code>. Departments: front_desk, concierge, housekeeping, kitchen, maintenance, manager. Each person gets their own login with a one-time temporary password.</p>
          <textarea aria-label="Staff CSV" rows={6} className={inputCls} placeholder={'Meera, meera@hotel.com, front_desk, +919811100001, yes\nPrakash, prakash@hotel.com, maintenance, +919811100002, yes'} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <input type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" className="mt-2 block min-h-11 w-full" onChange={async (e) => { const f = e.target.files?.[0]; if (f && f.size < 200_000) setCsv(await f.text()); }} />
          <button type="button" disabled={busy} className={btnCls + ' mt-2'} onClick={() => void doImport()}>{busy ? 'Adding…' : 'Add these people'}</button>
          {results && (
            <div className="mt-3" role="status">
              <p className="text-sm font-bold">Hand these out now. The passwords are shown only once and each person must change theirs at first sign-in.</p>
              <ul className="mt-1 space-y-1 text-sm">{results.map((r) => <li key={r.email}><b>{r.email}</b> — {r.ok ? <code>{r.temporary_password}</code> : r.error === 'exists' ? 'already has a login' : 'could not be added'}</li>)}</ul>
              <button type="button" className={btnCls + ' mt-2'} onClick={download}>Download as CSV</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
