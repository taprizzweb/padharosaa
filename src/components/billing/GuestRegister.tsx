'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/components/staff/hooks';
import { ns } from '@/components/ui/ns';
import { dateLabel, dayFromToday, rupees2 } from '@/lib/padharosaa/billing';
import { errText, td, th, type Flash } from './common';

interface Req { at: string; label: string; detail: string | null; status: string; urgent: boolean; team: string; resolution: string | null }
interface Guest { stay_id: string; room: string; name: string; mobile: string | null; id_type: string | null; id_last4: string | null; adults: number; company: string | null; check_in_at: string; checked_out_at: string | null; arrived: boolean; left: boolean; total_paise: number | null; invoice: string | null; requests: Req[] }
interface Register { from: string; to: string; days: { day: string; arrivals: number; departures: number; in_hotel: number; guests: Guest[] }[] }

const PRESETS: [string, string, number][] = [['week', 'Last 7 days', 6], ['today', 'Today', 0], ['two', 'Last 2 days', 1], ['month', 'Last 31 days', 30]];
const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const STATUS: Record<string, string> = { received: 'waiting', accepted: 'taken', preparing: 'in progress', ready: 'ready', completed: 'done', dismissed: 'declined', cancelled: 'cancelled', expired: 'not answered' };
const ID: Record<string, string> = { aadhaar: 'Aadhaar', passport: 'Passport', driving_licence: 'Driving licence', voter_id: 'Voter ID', other: 'ID' };

/** The entry register: for each day, every guest in the hotel (arrived, staying, left), their ID and phone, and what each of them asked for or complained about that day. Prints as a day-end sheet. */
export function GuestRegister({ flash }: { flash: Flash }) {
  const [span, setSpan] = useState(6);
  const [r, setR] = useState<Register | null>(null);
  const load = useCallback(async (back: number) => {
    try { setR(await apiGet<Register>(`/api/padharosaa/v1/staff/register?from=${dayFromToday(-back)}&to=${dayFromToday(0)}`)); } catch (e) { flash(false, errText(e, 'The register could not be loaded.')); }
  }, [flash]);
  useEffect(() => { void load(span); }, [span, load]);
  const days = r ? [...r.days].reverse() : [];
  return (
    <div className="mt-4" data-testid="guest-register">
      <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Period">
        {PRESETS.map(([k, label, back]) => <button key={k} type="button" aria-pressed={span === back} onClick={() => setSpan(back)} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${span === back ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white'}`}>{label}</button>)}
        <button type="button" className={`${ns.secondary} ml-auto`} onClick={() => window.print()} disabled={!r}>Print the register</button>
      </div>
      {!r && <p className="mt-6" role="status">…</p>}
      {r && days.every((d) => d.guests.length === 0) && <p className="mt-4 text-sm text-stone-600">No guests in these days.</p>}
      {days.filter((d) => d.guests.length > 0).map((d) => (
        <section key={d.day} className={`mt-4 ${ns.card} !p-0 overflow-x-auto break-inside-avoid`} aria-label={d.day}>
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2.5">
            <h2 className="text-base font-semibold tracking-tight">{dateLabel(d.day)}</h2>
            <p className="text-xs text-stone-600">{d.in_hotel} in the hotel · {d.arrivals} arrived · {d.departures} left</p>
          </header>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-stone-200"><th className={th}>Room</th><th className={th}>Guest</th><th className={th}>Came / left</th><th className={th}>Asked for / issues</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {d.guests.map((g) => (
                <tr key={g.stay_id}>
                  <td className={`${td} font-semibold`}>{g.room}</td>
                  <td className={td}>
                    <b>{g.name}</b>{g.adults > 1 ? ` + ${g.adults - 1}` : ''}
                    <span className="block text-xs text-stone-500">{[g.mobile, g.id_type ? `${ID[g.id_type] ?? 'ID'} ····${g.id_last4 ?? ''}` : null, g.company].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className={td}>
                    {g.arrived ? <>Came {time(g.check_in_at)}</> : <span className="text-stone-500">Staying</span>}
                    {g.left && g.checked_out_at && <span className="block">Left {time(g.checked_out_at)}{g.total_paise !== null ? ` · ${rupees2(g.total_paise)}` : ''}{g.invoice ? ` · ${g.invoice}` : ''}</span>}
                  </td>
                  <td className={td}>
                    {g.requests.length === 0 ? <span className="text-stone-400">—</span> : (
                      <ul className="space-y-1">{g.requests.map((q, i) => (
                        <li key={i}><span className="text-xs text-stone-500">{time(q.at)}</span> {q.urgent && <b className="text-red-800">Urgent · </b>}{q.label}{q.detail ? ` (${q.detail})` : ''} <span className="text-xs text-stone-500">· {STATUS[q.status] ?? q.status}</span></li>
                      ))}</ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
