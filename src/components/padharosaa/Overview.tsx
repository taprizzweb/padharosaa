'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/components/staff/hooks';
import { Card, Stat, ns } from '@/components/ui/ns';
import { formatPaise } from '@/lib/money';
import { dayFromToday, rupees2 } from '@/lib/padharosaa/billing';
import { occupancy, type Chart } from '@/lib/padharosaa/frontoffice';
import { totals, type Report } from '@/lib/padharosaa/reports';

interface Data {
  today: string; guests_in: number; rooms_with_guests: number; requests_today: number; open_now: number; waiting_now: number; urgent_today: number; done_today: number;
  avg_accept_minutes: number | null; avg_done_minutes: number | null; orders_today: number; orders_paise_today: number;
  by_type: { type: string; n: number }[]; by_hour: number[]; last_days: { date: string; n: number }[];
}
const TYPE: Record<string, string> = { housekeeping: 'Housekeeping', wake: 'Wake-up call', cab: 'Cab', late_checkout: 'Late check-out', reservation: 'Table reservation', help: 'Help / problem', food: 'Food', checkout: 'Check-out', plan: 'Plan', errand: 'Errand', artisan: 'Crafts', skip_line: 'Skip the line', vista: 'Sightseeing' };
const mins = (m: number | null) => (m === null ? 'n/a' : m < 1 ? '< 1 min' : `${Math.round(m)} min`);
const hour12 = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;

/** Plain SVG bars, no chart library: a column per hour (or day), the tallest one fills the height. */
function Bars({ values, labels, height = 96, label }: { values: number[]; labels: string[]; height?: number; label: string }) {
  const max = Math.max(1, ...values);
  const w = 100 / values.length;
  return (
    <svg viewBox={`0 0 100 ${height / 4 + 10}`} role="img" aria-label={label} className="mt-2 w-full">
      {values.map((v, i) => {
        const h = (v / max) * (height / 4);
        return (
          <g key={i}>
            <rect x={i * w + w * 0.15} y={height / 4 - h} width={w * 0.7} height={Math.max(h, v > 0 ? 0.8 : 0.3)} rx={0.6} className={v > 0 ? 'fill-indigo-900' : 'fill-stone-200'} />
            {(values.length <= 8 || i % 3 === 0) && <text x={i * w + w / 2} y={height / 4 + 6} textAnchor="middle" className="fill-stone-500" style={{ fontSize: 3.2 }}>{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

interface Kpi { occupancy: number; inHouse: number; rooms: number; arrivals: number; departures: number; dirty: number; sales: number; week: number[]; weekLabels: string[] }
/** The hotel's day in five numbers and a week of sales. Shown only when the hotel uses rooms and billing (the calls are refused otherwise). */
function HotelKpis() {
  const [k, setK] = useState<Kpi | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const today = dayFromToday(0);
        const [chart, rep] = await Promise.all([apiGet<Chart>('/api/padharosaa/v1/staff/frontoffice/chart?days=1'), apiGet<Report>(`/api/padharosaa/v1/staff/reports?from=${dayFromToday(-6)}&to=${today}`)]);
        const t = totals({ ...rep, days: rep.days.slice(-1) });
        if (alive) setK({ occupancy: occupancy(chart.summary), inHouse: chart.summary.in_house, rooms: chart.summary.rooms, arrivals: chart.summary.arrivals, departures: chart.summary.departures, dirty: chart.summary.dirty, sales: t.sales, week: rep.days.map((d) => d.room + d.food + d.other), weekLabels: rep.days.map((d) => d.day.slice(8)) });
      } catch { /* not a rooms-and-billing hotel: show nothing */ }
    })();
    return () => { alive = false; };
  }, []);
  if (!k) return null;
  return (
    <div data-testid="hotel-kpis" className="mt-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Occupancy" value={`${k.occupancy}%`} sub={`${k.inHouse} of ${k.rooms} rooms`} />
        <Stat label="Sales today" value={rupees2(k.sales)} sub="before tax" />
        <Stat label="Arriving" value={k.arrivals} sub="today" />
        <Stat label="Leaving" value={k.departures} sub="today" />
        <Stat label="To clean" value={k.dirty} tone={k.dirty ? 'warn' : 'plain'} />
      </div>
      <Card title="Sales, last 7 days" hint="Rooms, food and other, before tax."><Bars values={k.week} labels={k.weekLabels} label="Sales per day, last 7 days" /></Card>
    </div>
  );
}

export function Overview() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => { try { setD(await apiGet<Data>('/api/padharosaa/v1/staff/overview')); setErr(false); } catch { setErr(true); } }, []);
  useEffect(() => { void load(); const i = setInterval(() => { if (!document.hidden) void load(); }, 30_000); return () => clearInterval(i); }, [load]);
  if (err && !d) return <Card><p role="alert" className="font-semibold">The overview could not be loaded.</p><button type="button" className={`${ns.secondary} mt-3`} onClick={() => void load()}>Try again</button></Card>;
  if (!d) return <p className="mt-6 text-center text-stone-600" role="status">Loading…</p>;
  const slow = (d.avg_accept_minutes ?? 0) > 10;
  return (
    <div data-testid="overview">
      <HotelKpis />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Guests in" value={d.guests_in} sub={`${d.rooms_with_guests} room${d.rooms_with_guests === 1 ? '' : 's'}`} />
        <Stat label="Requests" value={d.requests_today} sub={`today · ${d.done_today} done`} />
        <Stat label="Waiting now" value={d.waiting_now} sub={`${d.open_now} open in all`} tone={d.waiting_now > 0 ? 'warn' : 'good'} />
        <Stat label="Food orders" value={d.orders_today} sub={`${formatPaise(d.orders_paise_today)} · excl. GST`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Answered in (avg)" value={mins(d.avg_accept_minutes)} tone={slow ? 'warn' : 'plain'} sub={slow ? 'slower than 10 min' : 'time to Accept'} />
        <Stat label="Finished in (avg)" value={mins(d.avg_done_minutes)} sub="request to done" />
        <Stat label="Urgent today" value={d.urgent_today} tone={d.urgent_today > 0 ? 'warn' : 'plain'} />
      </div>
      <Card title="Busy hours today" hint="Requests by the hour guests sent them.">
        <Bars values={d.by_hour} labels={d.by_hour.map((_, h) => hour12(h))} label="Requests by hour today" />
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Last 7 days" hint="Requests per day.">
          <Bars values={d.last_days.map((x) => x.n)} labels={d.last_days.map((x) => new Date(`${x.date}T00:00:00Z`).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' }))} label="Requests in the last seven days" />
        </Card>
        <Card title="What guests ask for" hint="Today, most asked first.">
          {d.by_type.length === 0 ? <p className="text-sm text-stone-600">Nothing yet today.</p> : (
            <ul className="space-y-2">
              {d.by_type.map((t) => (
                <li key={t.type}>
                  <div className="flex justify-between text-sm"><span className="font-semibold">{TYPE[t.type] ?? t.type}</span><span className="text-stone-600">{t.n}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-stone-100"><div className="h-1.5 rounded-full bg-indigo-900" style={{ width: `${Math.max(6, (t.n / d.by_type[0]!.n) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
