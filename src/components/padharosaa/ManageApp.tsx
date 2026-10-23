'use client';

import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ImageCropper } from '@/components/dash/ImageCropper';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ApiFailure } from '@/lib/guest/client';
import { BuffetManager } from './BuffetManager';
import { GuideManager } from './GuideManager';
import { GuestLinkPanel, RoomsCard, type LinkState } from './RoomsLink';
import { parseStaffCsv } from '@/lib/padharosaa/csv';
import { buildTheme, contrast, normaliseHex } from '@/lib/padharosaa/theme';

type Team = 'concierge' | 'front_desk' | 'housekeeping' | 'kitchen' | 'maintenance' | 'manager';
const TEAMS: [Team, string][] = [['front_desk', 'Front desk'], ['concierge', 'Concierge'], ['housekeeping', 'Housekeeping'], ['kitchen', 'Kitchen'], ['maintenance', 'Maintenance'], ['manager', 'Manager']];
interface Settings {
  brand_color: string | null; logo_path: string | null; hero_path: string | null; tripadvisor_url: string | null; menu_url: string | null; review_link: string | null;
  offer_text: string | null; offer_until: string | null; info_text: string | null; wifi_name: string | null; checkout_time: string | null; breakfast_text: string | null;
  reception_phone: string | null; manager_phone: string | null; room_dining: boolean; server_ready?: boolean;
}
interface Person { user_id: string; email: string; name: string; role: string; active: boolean; department: Team | null; whatsapp: string | null; is_head: boolean }
interface ImportResult { email: string; ok: boolean; error?: string; temporary_password?: string }

const inputCls = 'mt-1 min-h-11 w-full rounded-xl border-2 border-stone-300 bg-white px-3 text-base text-stone-900';
const btnCls = 'min-h-11 rounded-xl bg-stone-900 px-5 text-sm font-bold text-white disabled:opacity-50';

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm"><h2 className="text-lg font-extrabold">{title}</h2>{hint && <p className="text-sm text-stone-700">{hint}</p>}<div className="mt-3 space-y-3">{children}</div></section>;
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="block text-sm font-semibold">{label}{children}</label>;

export function ManageApp({ role, restaurant, supabase }: { role: string; restaurant: { id: string; name: string; slug: string }; supabase: { url: string; anonKey: string } }) {
  const sb = useMemo(() => createBrowserClient(supabase.url, supabase.anonKey), [supabase.url, supabase.anonKey]);
  const [s, setS] = useState<Settings | null>(null);
  const [insta, setInsta] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const [loadErr, setLoadErr] = useState<false | 'forbidden' | 'failed'>(false);
  const load = useCallback(async () => {
    try {
      const d = await apiGet<Settings & { instagram: string | null }>('/api/padharosaa/v1/staff/settings');
      setS(d); setInsta((d.instagram ?? '').replace(/^https:\/\/www\.instagram\.com\//, '@')); setLoadErr(false);
    } catch (e) { setLoadErr(e instanceof ApiFailure && e.status === 403 ? 'forbidden' : 'failed'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (path: string, body: unknown, done = 'Saved.') => {
    try { await apiPost(`/api/padharosaa/v1/staff/${path}`, body); flash(true, done); await load(); } catch { flash(false, 'That could not be saved. Please check the values and try again.'); }
  };

  if (!s) return <main className="p-8 text-center">{loadErr === 'forbidden' ? <p role="alert" className="mx-auto max-w-md font-semibold">This restaurant is not a Padharosaa hotel yet. Please ask Taprizz to switch Padharosaa on for it, then reload this page.</p> : loadErr ? <><p role="alert" className="font-semibold">The settings could not be loaded.</p><button type="button" className={btnCls + ' mt-3'} onClick={() => void load()}>Try again</button></> : 'Loading…'}</main>;
  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-stone-50 px-4 pb-24 pt-4 text-stone-900">
      <header className="flex items-center justify-between gap-2"><div><h1 className="text-xl font-extrabold">Manage Padharosaa</h1><p className="text-sm text-stone-700">{restaurant.name}</p></div><Link href="/padharosaa/desk" className="inline-flex min-h-11 items-center rounded-full border-2 border-stone-800 px-4 text-sm font-bold">Back to desk</Link></header>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{msg.text}</p>}
      {s.server_ready === false && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">Guest sign-in is switched off: the setting PADHAROSAA_DATA_KEY is missing on the server. Add it in your hosting settings (Vercel → Environment Variables) and redeploy. Until then guests cannot enter.</p>}
      <Checklist s={s} insta={insta} />
      <RoomsCard flash={flash} />
      <GuestLinkPanel slug={restaurant.slug} flash={flash} load={() => apiGet<LinkState>('/api/padharosaa/v1/staff/qr')} create={(password) => apiPost<{ link: string }>('/api/padharosaa/v1/staff/qr/rotate', { password })} />
      <HomeCard s={s} save={save} />
      <StayCard s={s} save={save} />
      <LookCard s={s} insta={insta} restaurantId={restaurant.id} sb={sb} save={save} />
      <Card title="Room dining" hint="Switch off if your hotel does not serve food to rooms. Then 'Room delivery' is never offered, and the kitchen can only choose Takeaway.">
        <label className="flex min-h-11 items-center gap-3 font-semibold"><input type="checkbox" className="h-5 w-5" checked={s.room_dining} onChange={(e) => void save('dining', { room_dining: e.target.checked })} />Our hotel serves food to rooms</label>
      </Card>
      <BuffetManager flash={flash} />
      <GuideManager flash={flash} />
      <TeamCard canImport={role === 'owner'} flash={flash} />
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
  const [f, setF] = useState({ wifi: s.wifi_name ?? '', pass: '', out: s.checkout_time ?? '', bf: s.breakfast_text ?? '', rec: s.reception_phone ?? '', mgr: s.manager_phone ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Stay, Wi-Fi and phone numbers" hint="The reception number appears as the always-visible Call reception button. Leave the password empty to keep the current one.">
      <Field label="Wi-Fi name"><input className={inputCls} maxLength={60} value={f.wifi} onChange={set('wifi')} /></Field>
      <Field label="Wi-Fi password (never shown again)"><input type="password" autoComplete="new-password" className={inputCls} maxLength={63} value={f.pass} onChange={set('pass')} /></Field>
      <Field label="Check-out time"><input className={inputCls} maxLength={40} value={f.out} onChange={set('out')} /></Field>
      <Field label="Breakfast"><input className={inputCls} maxLength={80} value={f.bf} onChange={set('bf')} /></Field>
      <Field label="Reception phone (digits, with country code)"><input inputMode="tel" className={inputCls} value={f.rec} onChange={set('rec')} /></Field>
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
  const [one, setOne] = useState({ name: '', email: '', department: 'front_desk' as Team, whatsapp: '', head: false });
  const load = useCallback(async () => { try { setPeople((await apiGet<{ staff: Person[] }>('/api/padharosaa/v1/staff/team')).staff); } catch { setPeople([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  const setProfile = async (p: Person, patch: Partial<Person>) => {
    const n = { ...p, ...patch };
    try { await apiPost(`/api/padharosaa/v1/staff/team/${p.user_id}`, { department: n.department ?? 'front_desk', whatsapp: n.whatsapp || null, is_head: n.is_head }); await load(); } catch { flash(false, 'Could not save. Use the number format +91 98765 43210.'); }
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
      if (r[0]?.ok) { setOne({ name: '', email: '', department: one.department, whatsapp: '', head: false }); flash(true, `${rows[0]!.name} can now sign in. Their one-time password is below.`); } else flash(false, r[0]?.error === 'exists' ? 'That email already has a login.' : 'That person could not be added.');
      await load();
    } catch { flash(false, 'The person could not be added. Please check the details.'); }
    setBusy(false);
  };
  const download = () => {
    const body = ['email,temporary_password,status', ...(results ?? []).map((r) => `${r.email},${r.temporary_password ?? ''},${r.ok ? 'created' : r.error}`)].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = 'new-staff-logins.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <Card title="Team" hint="Set each person's department and WhatsApp number. The head of a department gets the WhatsApp when a guest reports a problem for that department. Passwords are never shown here.">
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
