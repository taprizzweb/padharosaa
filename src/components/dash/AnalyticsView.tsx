'use client';
import { tableName } from '@/lib/rooms';
import { useState } from 'react';
import { Alert } from '@/components/guest/ui';
import { csvCell } from '@/lib/dash/csv';
import { fmtDateTime, useDashData } from './api';

interface Analytics {
  range: string; from: string;
  totals: { menu_opens: number; visits: number; qr_landings: number; item_views: number; searches: number; cart_adds: number; whatsapp: number; calls: number; directions: number; instagram: number; google_review: number; explore: number };
  daily: { day: string; opens: number; visits: number }[];
  top_items: { name: string; views: number }[];
  categories: { name: string; views: number }[];
  tables: { label: string; scans: number }[];
}
const RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']] as const;
const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function toCsv(a: Analytics): string {
  const rows: (string | number)[][] = [['section', 'name', 'value']];
  for (const [k, v] of Object.entries(a.totals)) rows.push(['total', k, v]);
  for (const d of a.daily) rows.push(['daily_menu_opens', d.day, d.opens], ['daily_visits', d.day, d.visits]);
  for (const i of a.top_items) rows.push(['dish_views', i.name, i.views]);
  for (const c of a.categories) rows.push(['category_views', c.name, c.views]);
  for (const t of a.tables) rows.push(['table_qr_scans', t.label, t.scans]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function AnalyticsView() {
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('7d');
  const { data, error } = useDashData<Analytics>('analytics', { range });
  const max = Math.max(1, ...(data?.daily.map((d) => d.opens) ?? [0]));
  const kpi = (label: string, value: number, note?: string) => (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <p className="text-sm font-semibold text-stone-700">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-stone-700">{note}</p>}
    </div>
  );
  const list = (title: string, id: string, rows: { name: string; n: number }[], empty: string, unit: string) => (
    <section aria-labelledby={id} className="rounded-2xl border border-stone-200 bg-white p-4">
      <h2 id={id} className="text-lg font-bold">{title}</h2>
      {rows.length === 0 ? <p className="mt-2 text-stone-700">{empty}</p> : (
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {rows.map((r) => <li key={r.name} className="flex justify-between gap-3 py-2"><span className="font-semibold">{r.name}</span><span className="tabular-nums">{r.n} {unit}</span></li>)}
        </ul>
      )}
    </section>
  );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Menu analytics</h1>
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
            {kpi('Menu opens', data.totals.menu_opens)}
            {kpi('Visitors', data.totals.visits, 'browser tabs, not people')}
            {kpi('Table QR scans', data.totals.qr_landings)}
            {kpi('Dish views', data.totals.item_views)}
            {kpi('Searches', data.totals.searches)}
            {kpi('Added to cart', data.totals.cart_adds)}
            {kpi('“Explore more” taps', data.totals.explore, 'taps, not visits')}
          </div>
          <section aria-labelledby="daily" className="rounded-2xl border border-stone-200 bg-white p-4">
            <h2 id="daily" className="text-lg font-bold">Menu opens per day</h2>
            <ul className="mt-2 space-y-1">
              {data.daily.map((d) => (
                <li key={d.day} className="flex items-center gap-3 text-sm">
                  <span className="w-14 shrink-0 font-semibold">{dayLabel(d.day)}</span>
                  <span aria-hidden className="h-4 rounded bg-accent" style={{ width: `${Math.max(d.opens ? 2 : 0, (d.opens / max) * 100)}%` }} />
                  <span className="tabular-nums">{d.opens}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            {list('Most viewed dishes', 'dishes', data.top_items.map((i) => ({ name: i.name, n: i.views })), 'No dish has been opened yet.', 'views')}
            {list('Most opened categories', 'cats', data.categories.map((c) => ({ name: c.name, n: c.views })), 'No category has been tapped yet.', 'taps')}
            {list('QR scans by table', 'tables', data.tables.map((t) => ({ name: tableName(t.label), n: t.scans })), 'No table QR has been scanned yet.', 'scans')}
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4 text-sm text-stone-800">
            <p className="font-semibold">How to read these numbers</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Everything here is measured, nothing is estimated. Numbers start from when this feature went live.</li>
              <li>A visitor is one phone browser tab, found by a random code that is not saved on the phone after the tab closes. The same person on another day or another phone counts again.</li>
              <li>Opening or viewing the same thing again within 30 minutes counts once, so refreshing the page does not inflate the numbers.</li>
              <li>Phones that ask websites not to track them are not counted at all, so real use is a bit higher.</li>
              <li>A tap on “Explore more before leaving” is a tap only. It does not show that the other site was opened or used.</li>
              <li>Menu views are not sales. For sales see the Report page. We keep these events for 180 days. Nothing here identifies a person: no name, phone number, address or IP address is stored.</li>
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 bg-white px-4 text-sm font-semibold" onClick={() => {
              const url = URL.createObjectURL(new Blob([`﻿${toCsv(data)}`], { type: 'text/csv;charset=utf-8' }));
              const a = document.createElement('a');
              a.href = url; a.download = `menu-analytics-${range}.csv`; a.click();
              URL.revokeObjectURL(url);
            }}>Download as CSV</button>
            <p className="text-sm text-stone-700">From {fmtDateTime(data.from)}. Days run midnight to midnight in India.</p>
          </div>
        </div>
      )}
    </div>
  );
}
