'use client';
import { useState } from 'react';
import { Alert } from '@/components/guest/ui';
import { formatPaise } from '@/lib/money';
import { useDashData } from './api';

interface Report {
  range: string; orders: number; cancelled: number; revenue_paise: number; average_order_paise: number; review_taps: number;
  top_dishes: { name: string; qty: number; revenue_paise: number }[]; peak_hours: { hour: number; orders: number }[];
}
const RANGES = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']] as const;
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

export function ReportView() {
  const [range, setRange] = useState<'today' | '7d' | '30d'>('today');
  const { data, error } = useDashData<Report>('report', { range });
  const max = Math.max(1, ...(data?.peak_hours.map((h) => h.orders) ?? [0]));
  const kpi = (label: string, value: string) => (
    <div className="rounded-2xl border border-stone-200 bg-white p-4"><p className="text-sm font-semibold text-stone-700">{label}</p><p className="mt-1 text-2xl font-extrabold">{value}</p></div>
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Report</h1>
        <div role="group" aria-label="Time range" className="flex gap-1">
          {RANGES.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)} className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${range === k ? 'bg-accent text-white' : 'border border-stone-300 bg-white'}`}>{l}</button>
          ))}
        </div>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {!data && !error && <p className="mt-6 text-stone-700">Loading…</p>}
      {data && (
        <div className="mt-4 space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpi('Orders', String(data.orders))}
            {kpi('Average order', formatPaise(data.average_order_paise))}
            {kpi('Total sales', formatPaise(data.revenue_paise))}
            {kpi('Review button taps', String(data.review_taps))}
          </div>
          <p className="text-sm text-stone-700">Cancelled orders ({data.cancelled}) are not counted. Days run from midnight to midnight in India.</p>
          <section aria-labelledby="top" className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 id="top" className="text-lg font-bold">Top 10 dishes</h2>
            {data.top_dishes.length === 0 ? <p className="mt-2 text-stone-700">No orders in this period yet.</p> : (
              <table className="mt-2 w-full text-left text-sm">
                <thead><tr><th scope="col" className="py-2">Dish</th><th scope="col" className="py-2 text-right">Sold</th><th scope="col" className="py-2 text-right">Sales</th></tr></thead>
                <tbody>{data.top_dishes.map((d) => <tr key={d.name} className="border-t border-stone-100"><td className="py-2 font-semibold">{d.name}</td><td className="py-2 text-right">{d.qty}</td><td className="py-2 text-right">{formatPaise(d.revenue_paise)}</td></tr>)}</tbody>
              </table>
            )}
          </section>
          <section aria-labelledby="peak" className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 id="peak" className="text-lg font-bold">Busiest hours</h2>
            <ul className="mt-2 space-y-1">
              {data.peak_hours.filter((h) => h.orders > 0).length === 0 && <li className="text-stone-700">No orders in this period yet.</li>}
              {data.peak_hours.filter((h) => h.orders > 0).map((h) => (
                <li key={h.hour} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 font-semibold">{hourLabel(h.hour)}</span>
                  <span aria-hidden className="h-4 rounded bg-accent" style={{ width: `${Math.max(2, (h.orders / max) * 100)}%` }} />
                  <span>{h.orders} order{h.orders === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
