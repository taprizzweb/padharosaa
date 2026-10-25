'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { ApiFailure } from '@/lib/guest/client';

interface Day { date: string; set: boolean; mode: 'in_house' | 'outdoor' | 'none' | null; name: string | null; start: string | null; end: string | null; venue: string | null; highlights: string | null; mood: string | null }
const inputCls = 'mt-1 min-h-11 w-full rounded-xl border-2 border-stone-300 bg-white px-3 text-base text-stone-900';
const clock12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`; };
const label = (date: string, today: string) => {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return `${diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : ''} ${new Date(`${date}T00:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`.trim();
};

export function BuffetManager({ flash, bare }: { flash: (ok: boolean, t: string) => void; bare?: boolean }) {
  const [d, setD] = useState<{ today: string; days: Day[]; notify_time: string | null; notify_on_save: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await apiGet('/api/padharosaa/v1/staff/buffet')); } catch { flash(false, 'The buffet list could not be loaded.'); } }, [flash]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return null;
  return (
    <section className={bare ? 'mt-2' : 'mt-4 rounded-2xl bg-white p-4 shadow-sm'} aria-labelledby="buffet-h">
      <h2 id="buffet-h" className={bare ? 'sr-only' : 'text-lg font-extrabold'}>Buffet</h2>
      <p className="text-sm text-stone-700">Set it for today and the coming week. Guests see today and the next two days.</p>
      <NotifyCard time={d.notify_time ?? ''} onSave={d.notify_on_save} flash={flash} />
      <ul className="mt-3 space-y-2">{d.days.map((x) => <DayRow key={x.date} day={x} today={d.today} open={open === x.date} onOpen={() => setOpen(open === x.date ? null : x.date)} onSaved={async (ok) => { flash(ok, ok ? 'Buffet saved.' : 'Please check the times and name.'); if (ok) { setOpen(null); await load(); } }} />)}</ul>
    </section>
  );
}

function DayRow({ day, today, open, onOpen, onSaved }: { day: Day; today: string; open: boolean; onOpen: () => void; onSaved: (ok: boolean) => Promise<void> }) {
  const [f, setF] = useState({ mode: day.mode ?? 'in_house', name: day.name ?? '', start: day.start ?? '19:30', end: day.end ?? '22:30', venue: day.venue ?? '', highlights: day.highlights ?? '', mood: day.mood ?? '' });
  const save = async () => {
    try {
      await apiPost('/api/padharosaa/v1/staff/buffet', { date: day.date, mode: f.mode, ...(f.mode === 'none' ? {} : { name: f.name, start: f.start, end: f.end }), ...(f.venue ? { venue: f.venue } : {}), ...(f.highlights ? { highlights: f.highlights } : {}), ...(f.mood ? { mood: f.mood } : {}) });
      await onSaved(true);
    } catch { await onSaved(false); }
  };
  const summary = !day.set ? 'Not set' : day.mode === 'none' ? 'No buffet' : `${day.name} · ${day.start}–${day.end}${day.venue ? ` · ${day.venue}` : ''}`;
  return (
    <li className="rounded-xl border-2 border-stone-200 p-3">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" onClick={onOpen} aria-expanded={open}><span><b>{label(day.date, today)}</b> <span className="text-sm text-stone-700">· {summary}</span></span><span aria-hidden>{open ? '−' : '+'}</span></button>
      {open && (
        <div className="mt-2 space-y-2">
          <label className="block text-sm font-semibold">What is planned
            <select className={inputCls} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as typeof f.mode })}><option value="in_house">Buffet in the hotel</option><option value="outdoor">Outdoor / special event</option><option value="none">No buffet</option></select></label>
          {f.mode !== 'none' && (
            <>
              <label className="block text-sm font-semibold">Name (e.g. Thali night)<input className={inputCls} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <div className="grid grid-cols-2 gap-2"><label className="block text-sm font-semibold">From<input type="time" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
                <label className="block text-sm font-semibold">Until<input type="time" className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label></div>
              <label className="block text-sm font-semibold">Where<input className={inputCls} maxLength={80} value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></label>
              <label className="block text-sm font-semibold">What is on the table<input className={inputCls} maxLength={300} value={f.highlights} onChange={(e) => setF({ ...f, highlights: e.target.value })} /></label>
              <label className="block text-sm font-semibold">Mood (optional, e.g. folk music)<input className={inputCls} maxLength={80} value={f.mood} onChange={(e) => setF({ ...f, mood: e.target.value })} /></label>
            </>
          )}
          <button type="button" className="min-h-11 rounded-xl bg-stone-900 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={f.mode !== 'none' && (!f.name.trim() || !f.start || !f.end)} onClick={() => void save()}>Save</button>
        </div>
      )}
    </li>
  );
}

/** When guests' phones are told: right after today's buffet is saved, and once more every day at a time the hotel picks. */
function NotifyCard({ time, onSave, flash }: { time: string; onSave: boolean; flash: (ok: boolean, t: string) => void }) {
  const [t, setT] = useState(time);
  const [on, setOn] = useState(onSave);
  const [saved, setSaved] = useState({ time, onSave }); // what is stored now (the line under the buttons)
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const test = async () => {
    setTesting(true); setResult(null);
    try {
      const r = await apiPost<{ configured: boolean; targets: number; sent: number; dropped: number; failed: number; codes: number[] }>('/api/padharosaa/v1/staff/buffet/notify/test', {});
      setResult(!r.configured ? 'Alerts are not switched on for this website yet (the keys are missing).' : r.targets === 0 ? 'No guest phone has allowed alerts yet. A guest must tap "Get buffet alerts on this phone" on their home screen first.' : `Test sent: ${r.sent} phone${r.sent === 1 ? '' : 's'} reached${r.dropped ? `, ${r.dropped} no longer exist${r.dropped === 1 ? 's' : ''} and ${r.dropped === 1 ? 'was' : 'were'} removed` : ''}${r.failed ? `, ${r.failed} failed (code ${r.codes.join(', ')})` : ''}.`);
    } catch { setResult('The test could not be sent. Please try again.'); }
    setTesting(false);
  };
  const save = async (nt: string, ns: boolean) => {
    try { await apiPost('/api/padharosaa/v1/staff/buffet/notify', { time: nt, onSave: ns }); setSaved({ time: nt, onSave: ns }); flash(true, 'Alert settings saved.'); } catch (e) { flash(false, `The alert settings could not be saved${e instanceof ApiFailure ? ` (${e.status} ${e.key}${e.requestId ? `, ref ${e.requestId.slice(0, 8)}` : ''})` : ''}.`); }
  };
  return (
    <div className="mt-3 rounded-xl border-2 border-stone-200 p-3" data-testid="buffet-notify">
      <p className="text-sm font-bold">Phone alerts to guests</p>
      <p className="text-sm text-stone-700">Guests who allowed alerts on their phone get a message.</p>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-5" checked={on} onChange={(e) => { setOn(e.target.checked); void save(t, e.target.checked); }} />Send when today&apos;s buffet is saved</label>
      <div className="mt-1 flex flex-wrap items-end gap-2">
        <label className="block text-sm font-semibold">Remind everyone every day at<input type="time" className={inputCls} value={t} onChange={(e) => setT(e.target.value)} /></label>
        <button type="button" className="min-h-11 rounded-xl bg-stone-900 px-4 text-sm font-bold text-white" onClick={() => void save(t, on)}>Save time</button>
        {t && <button type="button" className="min-h-11 rounded-xl border-2 border-stone-300 px-4 text-sm font-bold" onClick={() => { setT(''); void save('', on); }}>No daily reminder</button>}
      </div>
      <p className="mt-2 text-sm font-semibold" data-testid="notify-state">{saved.time ? `Saved: a reminder goes to every guest phone every day at ${clock12(saved.time)}, when today's buffet is set.` : 'No daily reminder is set.'} {saved.onSave ? 'A message also goes out when you save today\'s buffet.' : 'Saving the buffet sends no message.'}</p>
      <button type="button" disabled={testing} className="mt-2 min-h-11 rounded-xl border-2 border-stone-800 px-4 text-sm font-bold disabled:opacity-50" onClick={() => void test()}>{testing ? 'Sending…' : 'Send a test alert now'}</button>
      {result && <p role="status" className="mt-2 rounded-xl bg-stone-100 p-3 text-sm font-semibold" data-testid="notify-test">{result}</p>}
    </div>
  );
}
