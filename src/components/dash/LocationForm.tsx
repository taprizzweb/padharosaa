'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Notice, btnPrimary, btnSecondary } from '@/components/guest/ui';
import { dashPost, errText, inputCls } from './api';

export interface Geo { geo_required: boolean; geo_lat: number | null; geo_lng: number | null; geo_radius_m: number }

/** "Only take orders near the cafe". Owner only. Guests' positions are used for one check and never stored. */
export function LocationForm({ g, canEdit }: { g: Geo; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ on: g.geo_required, lat: g.geo_lat?.toString() ?? '', lng: g.geo_lng?.toString() ?? '', radius: String(g.geo_radius_m) });
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const useHere = () => {
    setErr(null); setOk(false);
    if (!navigator.geolocation) return setErr('This browser cannot share its location.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })); setLocating(false); },
      () => { setLocating(false); setErr('Your phone did not share its location. Allow location for this site, or type the numbers yourself.'); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  return (
    <form className="mt-6 space-y-4 rounded-2xl border border-stone-200 bg-white p-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setErr(null); setOk(false);
      try {
        await dashPost('location-save', { required: f.on, lat: num(f.lat), lng: num(f.lng), radius_m: Number(f.radius) });
        setOk(true);
        router.refresh();
      } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
    }}>
      <h2 className="text-lg font-bold">Orders only near the cafe</h2>
      <p className="text-sm text-stone-700">When this is on, a guest’s phone must be near your cafe to place an order (the table QR is still needed). Guests who are far away, or who refuse to share their location, are asked to call a team member instead.</p>
      <fieldset disabled={!canEdit} className="space-y-4">
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={f.on} onChange={(e) => setF({ ...f, on: e.target.checked })} className="h-5 w-5" />
          Only take orders from guests near the cafe
        </label>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Cafe position</p>
          <button type="button" className={btnSecondary} onClick={useHere} disabled={locating}>{locating ? 'Finding your position…' : 'Use this device’s location'}</button>
          <p className="text-sm text-stone-700">Do this while you are standing inside the cafe, on your phone, with GPS on.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">Latitude<input inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} className={inputCls} /></label>
            <label className="block text-sm font-semibold">Longitude<input inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} className={inputCls} /></label>
          </div>
        </div>
        <label className="block text-sm font-semibold">How near is “near”
          <select value={f.radius} onChange={(e) => setF({ ...f, radius: e.target.value })} className={inputCls}>
            {[100, 150, 250, 500, 1000].map((m) => <option key={m} value={m}>Within {m} metres</option>)}
          </select>
          <span className="block text-sm font-normal text-stone-700">Phone GPS can be off by 20 to 100 metres indoors, so do not set this too small.</span>
        </label>
      </fieldset>
      <div className="rounded-xl bg-stone-100 p-3 text-sm text-stone-800">
        <p className="font-semibold">Good to know</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>A guest’s location is used for one distance check and is not saved anywhere.</li>
          <li>This reduces orders from home. It cannot stop someone who fakes their phone’s location.</li>
        </ul>
      </div>
      {err && <Alert>{err}</Alert>}
      {ok && <Notice>Saved.</Notice>}
      {canEdit && <button type="submit" disabled={busy} className={`${btnPrimary} w-full sm:w-auto`}>Save</button>}
    </form>
  );
}
