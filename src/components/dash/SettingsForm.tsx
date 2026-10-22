'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Notice, btnPrimary } from '@/components/guest/ui';
import { ACCENTS, type AccentKey } from '@/lib/accent';
import { LocationForm, type Geo } from './LocationForm';
import { ProfileForm, type Profile } from './ProfileForm';
import { dashPost, errText, fmtDateTime, inputCls, useDashData } from './api';

interface Settings extends Profile, Geo { name: string; slug: string; review_url: string | null; accent: AccentKey; amber_minutes: number; red_minutes: number; plan: string; paid_until: string | null; status: string }

export function SettingsForm({ canEdit, supabase, imageBase }: { canEdit: boolean; supabase: { url: string; anonKey: string }; imageBase: string }) {
  const { data, error } = useDashData<Settings>('settings');
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-stone-700">Loading…</p>;
  return <Form s={data} canEdit={canEdit} supabase={supabase} imageBase={imageBase} />;
}

function Form({ s, canEdit, supabase, imageBase }: { s: Settings; canEdit: boolean; supabase: { url: string; anonKey: string }; imageBase: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: s.name, review: s.review_url ?? '', accent: s.accent, amber: String(s.amber_minutes), red: String(s.red_minutes) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <div>
      <h1 className="text-2xl font-extrabold">Settings</h1>
      {!canEdit && <div className="mt-3"><Notice>Only the owner can change settings. You can see them here.</Notice></div>}
      <form className="mt-4 space-y-5 rounded-2xl border border-stone-200 bg-white p-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setErr(null); setOk(false);
        try {
          await dashPost('settings-save', { name: f.name, review_url: f.review, accent: f.accent, amber_minutes: Number(f.amber), red_minutes: Number(f.red) });
          setOk(true);
          router.refresh();
        } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
      }}>
        <fieldset disabled={!canEdit} className="space-y-5">
          <label className="block text-sm font-semibold">Restaurant name
            <input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} />
          </label>
          <label className="block text-sm font-semibold">Google review link (optional)
            <input type="url" inputMode="url" placeholder="https://g.page/…" value={f.review} onChange={(e) => setF({ ...f, review: e.target.value })} className={inputCls} />
            <span className="mt-1 block text-sm font-normal text-stone-700">Guests see a “Rate us” button after their meal when this is filled in. It must start with https://</span>
          </label>
          <fieldset>
            <legend className="text-sm font-semibold">Accent colour</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(Object.keys(ACCENTS) as AccentKey[]).map((k) => (
                <label key={k} className="relative">
                  <input type="radio" name="accent" value={k} checked={f.accent === k} onChange={() => setF({ ...f, accent: k })} className="peer sr-only" />
                  <span className="flex min-h-11 min-w-11 items-center gap-2 rounded-xl border-2 border-stone-300 px-3 text-sm font-semibold capitalize peer-checked:border-stone-900 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                    <span aria-hidden className="h-5 w-5 rounded-full" style={{ background: ACCENTS[k] }} />{k}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">Turn amber after (minutes)
              <input type="number" min={1} max={120} required value={f.amber} onChange={(e) => setF({ ...f, amber: e.target.value })} className={inputCls} />
            </label>
            <label className="block text-sm font-semibold">Turn red after (minutes)
              <input type="number" min={2} max={240} required value={f.red} onChange={(e) => setF({ ...f, red: e.target.value })} className={inputCls} />
            </label>
          </div>
          <p className="text-sm text-stone-700">Orders on the staff screen turn amber, then red, when they wait longer than this.</p>
        </fieldset>
        {err && <Alert>{err}</Alert>}
        {ok && <Notice>Settings saved.</Notice>}
        {canEdit && <button type="submit" disabled={busy} className={`${btnPrimary} w-full sm:w-auto`}>Save settings</button>}
      </form>
      <LocationForm g={s} canEdit={canEdit} />
      <ProfileForm p={s} canEdit={canEdit} supabase={supabase} imageBase={imageBase} />
      <dl className="mt-6 grid gap-2 rounded-2xl border border-stone-200 bg-white p-4 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold">Guest menu address</dt><dd className="break-all text-stone-800">/{s.slug}</dd></div>
        <div><dt className="font-semibold">Plan</dt><dd className="text-stone-800 capitalize">{s.plan}</dd></div>
        <div><dt className="font-semibold">Paid until</dt><dd className="text-stone-800">{s.paid_until ? fmtDateTime(s.paid_until) : 'No end date'}</dd></div>
        <div><dt className="font-semibold">Status</dt><dd className="text-stone-800 capitalize">{s.status}</dd></div>
      </dl>
    </div>
  );
}
