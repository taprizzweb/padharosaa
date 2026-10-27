'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/components/staff/hooks';
import { Stat, ns } from '@/components/ui/ns';
import { errText, td, th } from '@/components/billing/common';
import { dayFromToday, payModeLabel, rupees2 } from '@/lib/padharosaa/billing';
import { PRESET_LABEL, range, toCsv, totals, type Preset, type Report } from '@/lib/padharosaa/reports';

/** The owner's numbers: sales by kind, money collected by mode, rooms sold, occupancy, average rate and revenue per room. */
export function ReportsApp() {
  const [preset, setPreset] = useState<Preset>('week');
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async (p: Preset) => {
    const { from, to } = range(p, dayFromToday(0));
    try { setR(await apiGet<Report>(`/api/padharosaa/v1/staff/reports?from=${from}&to=${to}`)); setErr(null); } catch (e) { setErr(errText(e, 'The report could not be loaded.')); }
  }, []);
  useEffect(() => { void load(preset); }, [preset, load]);
  const t = r ? totals(r) : null;
  const download = () => {
    if (!r) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCsv(r)], { type: 'text/csv' }));
    a.download = `report-${r.from}-to-${r.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const max = r ? Math.max(1, ...r.days.map((d) => d.room + d.food + d.other)) : 1;
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-3 text-stone-900">
      {err && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-900">{err}</p>}
      <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Period">
        {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => <button key={p} type="button" aria-pressed={preset === p} onClick={() => setPreset(p)} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${preset === p ? 'border-indigo-900 bg-indigo-900 text-white' : 'border-stone-300 bg-white'}`}>{PRESET_LABEL[p]}</button>)}
        <span className="ml-auto flex gap-2"><button type="button" className={ns.secondary} onClick={download} disabled={!r}>Download for Excel</button><button type="button" className={ns.secondary} onClick={() => window.print()}>Print</button></span>
      </div>
      {r && t && (
        <>
          <p className="mt-3 text-sm text-stone-600">{r.from === r.to ? r.from : `${r.from} to ${r.to}`} · sales are before tax</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="report-cards">
            <Stat label="Sales" value={rupees2(t.sales)} sub={`Rooms ${rupees2(t.room)} · Food ${rupees2(t.food)} · Other ${rupees2(t.other)}`} />
            <Stat label="Tax charged" value={rupees2(t.tax)} />
            <Stat label="Money collected" value={rupees2(t.collected)} sub="advances, payments, counter bills" />
            <Stat label="Rooms sold" value={t.roomsSold} sub={`${t.occupancyPct}% of ${t.roomNights} room-nights`} />
            <Stat label="Average room rate" value={rupees2(t.adr)} sub="room sales per room sold" />
            <Stat label="Revenue per room" value={rupees2(t.revpar)} sub="room sales per room available" />
            <Stat label="Invoices" value={t.invoices} />
            <Stat label="Counter bills" value={t.posBills} />
          </div>
          {Object.keys(r.by_mode).length > 0 && (
            <section className={`mt-4 ${ns.card}`} aria-label="Money by mode"><h2 className="text-base font-semibold tracking-tight">Money collected, by how it was paid</h2>
              <dl className="mt-2 grid gap-2 sm:grid-cols-3">{Object.entries(r.by_mode).map(([m, v]) => <div key={m} className="flex justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"><dt>{payModeLabel(m)}</dt><dd className="font-semibold">{rupees2(v)}</dd></div>)}</dl>
            </section>
          )}
          <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full min-w-[44rem] text-sm" data-testid="report-days">
              <thead className="border-b border-stone-200 bg-stone-50"><tr><th className={th}>Day</th><th className={`${th} text-right`}>Rooms</th><th className={`${th} text-right`}>Food</th><th className={`${th} text-right`}>Other</th><th className={`${th} text-right`}>Tax</th><th className={`${th} text-right`}>Collected</th><th className={`${th} text-right`}>Rooms sold</th><th className={th}> </th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {r.days.map((d) => (
                  <tr key={d.day}><td className={td}>{d.day}</td><td className={`${td} text-right`}>{rupees2(d.room)}</td><td className={`${td} text-right`}>{rupees2(d.food)}</td><td className={`${td} text-right`}>{rupees2(d.other)}</td><td className={`${td} text-right`}>{rupees2(d.tax)}</td><td className={`${td} text-right`}>{rupees2(d.collected)}</td><td className={`${td} text-right`}>{d.rooms_sold}</td>
                    <td className="w-32 px-3 py-2.5"><div aria-hidden className="h-2 rounded bg-indigo-700" style={{ width: `${Math.max(2, Math.round(((d.room + d.food + d.other) / max) * 100))}%` }} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!r && !err && <p className="mt-6" role="status">…</p>}
    </div>
  );
}
