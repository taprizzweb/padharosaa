'use client';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert, Notice, btnPrimary } from '@/components/guest/ui';
import { EXPLORE_BASE } from '@/lib/profile';
import { ImageCropper } from './ImageCropper';
import { dashPost, errText, inputCls } from './api';

export interface Profile {
  id: string; tagline: string | null; description: string | null; logo_path: string | null; banner_path: string | null;
  address: string | null; hours_text: string | null; explore_code: string | null;
}

/** Public profile: what guests see at the top of the menu. Only the owner can save. */
export function ProfileForm({ p, canEdit, supabase, imageBase }: { p: Profile; canEdit: boolean; supabase: { url: string; anonKey: string }; imageBase: string }) {
  const router = useRouter();
  const sb = useMemo(() => createBrowserClient(supabase.url, supabase.anonKey), [supabase.url, supabase.anonKey]);
  const [f, setF] = useState({
    tagline: p.tagline ?? '', description: p.description ?? '', logo: p.logo_path ?? '', banner: p.banner_path ?? '',
    address: p.address ?? '', hours: p.hours_text ?? '', explore: p.explore_code ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'banner' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const saved = { logo: p.logo_path ?? '', banner: p.banner_path ?? '' };
  const [cropping, setCropping] = useState<{ kind: 'logo' | 'banner'; file: File } | null>(null);

  async function upload(kind: 'logo' | 'banner', blob: Blob) {
    setErr(null); setUploading(kind);
    try {
      const path = `${p.id}/${crypto.randomUUID()}.webp`;
      const { error } = await sb.storage.from('menu-images').upload(path, blob, { contentType: 'image/webp', upsert: false });
      if (error) throw new Error('The picture could not be uploaded. Please try again.');
      const old = f[kind];
      setF((x) => ({ ...x, [kind]: path }));
      if (old && old !== saved[kind]) void sb.storage.from('menu-images').remove([old]); // an unsaved earlier pick
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The picture could not be uploaded.');
    } finally { setUploading(null); }
  }

  const imgBox = (kind: 'logo' | 'banner', label: string, hint: string) => (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      {f[kind] ? (
        // eslint-disable-next-line @next/next/no-img-element -- own storage, already shrunk
        <img src={`${imageBase}${f[kind]}`} alt={`Current ${label.toLowerCase()}`} className={kind === 'logo' ? 'mt-1 h-20 w-20 rounded-2xl border border-stone-200 object-cover' : 'mt-1 h-28 w-full max-w-md rounded-xl border border-stone-200 object-cover'} />
      ) : <p className="mt-1 text-sm text-stone-700">Not set</p>}
      <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Choose ${label.toLowerCase()}`} disabled={!canEdit || uploading !== null} className="mt-1 block min-h-11 w-full text-base" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setCropping({ kind, file }); }} />
      <p className="text-sm text-stone-700">{uploading === kind ? 'Uploading…' : hint}</p>
      {f[kind] && canEdit && <button type="button" className="mt-1 min-h-11 text-sm font-semibold underline" onClick={() => setF({ ...f, [kind]: '' })}>Remove {label.toLowerCase()}</button>}
    </div>
  );

  return (
    <form className="mt-6 space-y-5 rounded-2xl border border-stone-200 bg-white p-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setErr(null); setOk(false);
      try {
        await dashPost('profile-save', { tagline: f.tagline, description: f.description, logo_path: f.logo, banner_path: f.banner, address: f.address, hours_text: f.hours, explore_code: f.explore });
        setOk(true);
        router.refresh();
      } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
    }}>
      <h2 className="text-lg font-bold">Public profile</h2>
      <p className="text-sm text-stone-700">Guests see this at the top of your menu. Everything is optional; buttons only appear for what you fill in.</p>
      <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
        {imgBox('logo', 'Logo', 'A square picture works best. You will choose the visible part next.')}
        {imgBox('banner', 'Banner picture', 'A wide photo of your food or place works best. You will choose the visible part next.')}
        <label className="block text-sm font-semibold">Short tagline
          <input maxLength={120} value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} className={inputCls} />
        </label>
        <label className="block text-sm font-semibold">About your restaurant
          <textarea maxLength={400} rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputCls} />
        </label>
        <label className="block text-sm font-semibold">Address
          <input maxLength={200} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} className={inputCls} />
        </label>
        <label className="block text-sm font-semibold">Opening hours
          <input maxLength={200} placeholder="Daily 11 am – 11 pm" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} className={inputCls} />
        </label>
        <label className="block text-sm font-semibold">“Explore more before leaving” link
          <span className="mt-1 flex items-stretch overflow-hidden rounded-xl border border-stone-300 bg-white">
            <span className="flex shrink-0 items-center break-all bg-stone-100 px-3 text-xs font-normal text-stone-800 sm:text-sm">{EXPLORE_BASE}</span>
            <input value={f.explore} maxLength={300} placeholder="your-code" onChange={(e) => setF({ ...f, explore: e.target.value })} className="min-h-11 w-0 min-w-0 flex-1 px-3 text-base" aria-label="Explore link code" />
          </span>
          <span className="block text-sm font-normal text-stone-700">Type only the last part. Guests see one button, “Explore more before leaving”, at the bottom of your menu. Leave empty for no button.</span>
        </label>
      </fieldset>
      {err && <Alert>{err}</Alert>}
      {ok && <Notice>Profile saved. Your menu shows it straight away.</Notice>}
      {canEdit && <button type="submit" disabled={busy || uploading !== null} className={`${btnPrimary} w-full sm:w-auto`}>Save profile</button>}
      {cropping && (
        <ImageCropper
          file={cropping.file}
          aspect={cropping.kind === 'logo' ? 1 : 3 / 2}
          outWidth={cropping.kind === 'logo' ? 512 : 1600}
          title={cropping.kind === 'logo' ? 'Crop the logo' : 'Crop the banner'}
          onCancel={() => setCropping(null)}
          onDone={(blob) => { const k = cropping.kind; setCropping(null); void upload(k, blob); }}
        />
      )}
    </form>
  );
}
