'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ns } from '@/components/ui/ns';
import { Label, errText, field, small, td, th } from '@/components/billing/common';

const API = '/api/padharosaa/v1/staff/channels';
interface Status {
  link: { property_id: string | null; enabled: boolean; webhook_secret: string; last_push_at: string | null; last_pull_at: string | null; last_error: string | null } | null;
  types: { id: string; name: string; rooms: number; ext_room_type_id: string | null; ext_rate_plan_id: string | null }[];
  waiting: number; failed: number; channel_bookings: number; server_ready: boolean; webhook_url: string | null;
}
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never');

/** Channel manager: one place where prices and rooms left go out to the booking sites, and their bookings come in. */
export function ChannelsApp() {
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [prop, setProp] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [ids, setIds] = useState<Record<string, { room: string; rate: string }>>({});
  const flash = useCallback((ok: boolean, text: string) => { setMsg({ ok, text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const load = useCallback(async () => {
    try {
      const r = await apiGet<Status>(`${API}/status`);
      setS(r);
      setProp((p) => p || r.link?.property_id || '');
      setIds((cur) => Object.fromEntries(r.types.map((t) => [t.id, cur[t.id] ?? { room: t.ext_room_type_id ?? '', rate: t.ext_rate_plan_id ?? '' }])));
    } catch (e) { flash(false, errText(e, 'The channel settings could not be loaded.')); }
  }, [flash]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const i = setInterval(() => { if (!document.hidden) void load(); }, 20_000); return () => clearInterval(i); }, [load]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try { const t = await fn(); if (t) flash(true, t); await load(); } catch (e) { flash(false, errText(e, 'That did not work. Please try again.')); }
    setBusy(null);
  };
  const linked = s?.types.filter((t) => t.ext_room_type_id).length ?? 0;
  const on = !!s?.link?.enabled;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-3 text-stone-900">
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mb-3 rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-950' : 'bg-red-50 text-red-900'}`}>{msg.text}</p>}
      {s && !s.server_ready && <p role="alert" data-testid="channel-server-missing" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">The channel service key is not set on the server yet (CHANNEX_API_KEY). Until it is, nothing is sent. Taprizz sets this once for all hotels.</p>}
      {s && (
        <>
          <section className={ns.card} aria-label="Status" data-testid="channel-status">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${on ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-700'}`}>{on ? 'Switched on' : 'Switched off'}</span>
              <p className="text-sm text-stone-700">Prices sent: <b>{when(s.link?.last_push_at ?? null)}</b> · Bookings checked: <b>{when(s.link?.last_pull_at ?? null)}</b> · Bookings from sites: <b>{s.channel_bookings}</b></p>
            </div>
            <p className="mt-2 text-sm text-stone-700">{s.waiting} change{s.waiting === 1 ? '' : 's'} waiting to be sent{s.failed ? ` · ${s.failed} could not be sent` : ''}</p>
            {s.link?.last_error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-900">{s.link.last_error}</p>}
          </section>

          <section className={`mt-4 ${ns.card}`} aria-label="Connect">
            <h2 className="text-base font-semibold tracking-tight">1. Connect your hotel</h2>
            <p className="mt-1 text-sm text-stone-600">A channel manager is a separate service (we use Channex) that is connected to Booking.com, MakeMyTrip, Agoda and the others. It needs an account that Taprizz sets up for your hotel.</p>
            <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Where do I find the property id?</summary><ol className="list-decimal space-y-1 pl-5 text-stone-700"><li>Taprizz creates your hotel in Channex and connects your Booking.com / MakeMyTrip / Agoda accounts there.</li><li>In Channex, open <b>Properties</b> and click your hotel.</li><li>The property id is the long code (like <code>0a1b2c3d-…</code>) shown on that page and in the web address. Copy it here.</li><li>The room type and rate plan ids are in the same property, under <b>Rooms</b> and <b>Rate plans</b>.</li></ol><p className="mt-1 text-xs text-stone-500">You will not see these ids until Channex is set up. Until then leave this screen as it is: nothing is sent.</p></details>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1"><Label text="Property id"><input className={field} value={prop} maxLength={64} autoComplete="off" onChange={(e) => setProp(e.target.value.trim())} /></Label></div>
              <button type="button" className={ns.secondary} disabled={!prop || busy !== null || !s.server_ready} onClick={() => void run('save-test', async () => { await apiPost(`${API}/save`, { property_id: prop, enabled: on }); const r = await apiPost<{ name: string }>(`${API}/test`, {}); return `Connected to “${r.name}”.`; })}>{busy === 'save-test' ? 'Checking…' : 'Save and test the connection'}</button>
            </div>
          </section>

          <section className={`mt-4 ${ns.card}`} aria-label="Room types">
            <h2 className="text-base font-semibold tracking-tight">2. Match your room types</h2>
            <p className="mt-1 text-sm text-stone-600">For each room type, paste the room type id and the rate plan id from the channel service. Prices come from the Prices calendar, rooms left from your bookings and guests.</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[34rem] text-sm"><thead className="border-b border-stone-200"><tr><th className={th}>Room type</th><th className={th}>Room type id (service)</th><th className={th}>Rate plan id (service)</th><th className={th} /></tr></thead><tbody className="divide-y divide-stone-100">
              {s.types.map((t) => {
                const v = ids[t.id] ?? { room: '', rate: '' };
                return (
                  <tr key={t.id} data-testid="channel-type">
                    <td className={td}><b>{t.name}</b><span className="block text-xs text-stone-500">{t.rooms} room{t.rooms === 1 ? '' : 's'}</span></td>
                    <td className={td}><input aria-label={`Room type id for ${t.name}`} className={small + ' w-full'} value={v.room} maxLength={64} onChange={(e) => setIds({ ...ids, [t.id]: { ...v, room: e.target.value.trim() } })} /></td>
                    <td className={td}><input aria-label={`Rate plan id for ${t.name}`} className={small + ' w-full'} value={v.rate} maxLength={64} onChange={(e) => setIds({ ...ids, [t.id]: { ...v, rate: e.target.value.trim() } })} /></td>
                    <td className={`${td} text-right`}><span className="flex justify-end gap-1.5">
                      <button type="button" className={small} disabled={busy !== null || !v.room || !v.rate} onClick={() => void run(`map-${t.id}`, async () => { await apiPost(`${API}/map`, { type: t.id, ext_room_type_id: v.room, ext_rate_plan_id: v.rate }); return `${t.name} is matched.`; })}>Save</button>
                      {t.ext_room_type_id && <button type="button" className={small} disabled={busy !== null} onClick={() => void run(`unmap-${t.id}`, async () => { await apiPost(`${API}/map`, { type: t.id, ext_room_type_id: null, ext_rate_plan_id: null }); setIds((c) => ({ ...c, [t.id]: { room: '', rate: '' } })); return `${t.name} is no longer matched.`; })}>Unlink</button>}
                    </span></td>
                  </tr>
                );
              })}
              {s.types.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-stone-600">No room types yet. Add them in Billing → Taxes &amp; rates → Room types and rates.</td></tr>}
            </tbody></table></div>
          </section>

          <section className={`mt-4 ${ns.card}`} aria-label="Switch on">
            <h2 className="text-base font-semibold tracking-tight">3. Switch on</h2>
            <p className="mt-1 text-sm text-stone-600">{linked === 0 ? 'Match at least one room type first.' : 'Switching on sends the next year of prices and rooms left for every matched room type. After that, every change here goes out by itself within a minute.'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={on ? ns.secondary : ns.primary} disabled={busy !== null || (!on && (linked === 0 || !prop))} onClick={() => void run('toggle', async () => { await apiPost(`${API}/save`, { property_id: prop || null, enabled: !on }); return on ? 'Switched off. Nothing more is sent.' : 'Switched on. The first prices are going out now.'; })}>{on ? 'Switch off' : 'Switch on'}</button>
              {on && <button type="button" className={ns.secondary} disabled={busy !== null} onClick={() => void run('resync', async () => { await apiPost(`${API}/resync`, {}); return 'Everything will be sent again.'; })}>Send everything again</button>}
            </div>
          </section>

          {on && (
            <section className={`mt-4 ${ns.card}`} aria-label="Bookings">
              <h2 className="text-base font-semibold tracking-tight">Bookings from the sites</h2>
              <p className="mt-1 text-sm text-stone-600">A booking made on a site appears in Rooms → Bookings with the site&apos;s name, and the room is taken off the other sites. For this to be instant, the channel service needs to know your address:</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="max-w-full break-all rounded bg-stone-100 px-2 py-1 text-xs" data-testid="channel-webhook">{s.webhook_url}</code>
                <button type="button" className={small} onClick={() => { void navigator.clipboard?.writeText(s.webhook_url ?? ''); flash(true, 'Address copied.'); }}>Copy</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={ns.secondary} disabled={busy !== null || !s.server_ready} onClick={() => void run('hook', async () => { await apiPost(`${API}/webhook`, {}); return 'The channel service now tells us about every new booking.'; })}>Tell the service our address</button>
                <button type="button" className={ns.secondary} disabled={busy !== null || !s.server_ready} onClick={() => void run('pull', async () => { const r = await apiPost<{ applied: number }>(`${API}/pull`, {}); return r.applied ? `${r.applied} booking${r.applied === 1 ? '' : 's'} added or updated.` : 'No new bookings.'; })}>Check for bookings now</button>
              </div>
            </section>
          )}
        </>
      )}
      {!s && <p role="status" className="mt-6">…</p>}
    </div>
  );
}
