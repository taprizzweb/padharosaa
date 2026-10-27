import { addDays } from './frontoffice';

// Figures for the owner's report screen. The database sends the day-by-day numbers (whole paise); these helpers only add them up.
export interface ReportDay { day: string; room: number; food: number; other: number; tax: number; invoices: number; pos_bills: number; rooms_sold: number; collected: number }
export interface Report { from: string; to: string; rooms: number; days: ReportDay[]; by_mode: Record<string, number> }
export interface ReportTotals { sales: number; room: number; food: number; other: number; tax: number; collected: number; roomsSold: number; roomNights: number; occupancyPct: number; adr: number; revpar: number; invoices: number; posBills: number }

export function totals(r: Report): ReportTotals {
  const sum = (k: keyof ReportDay) => r.days.reduce((a, d) => a + Number(d[k] ?? 0), 0);
  const room = sum('room'), food = sum('food'), other = sum('other');
  const roomsSold = sum('rooms_sold');
  const nights = r.rooms * r.days.length;
  return {
    sales: room + food + other, room, food, other, tax: sum('tax'), collected: sum('collected'), roomsSold, roomNights: nights,
    occupancyPct: nights > 0 ? Math.round((roomsSold / nights) * 1000) / 10 : 0,
    adr: roomsSold > 0 ? Math.round(room / roomsSold) : 0, revpar: nights > 0 ? Math.round(room / nights) : 0, invoices: sum('invoices'), posBills: sum('pos_bills'),
  };
}

export type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastmonth';
export const PRESET_LABEL: Record<Preset, string> = { today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'This month', lastmonth: 'Last month' };
export function range(p: Preset, today: string): { from: string; to: string } {
  if (p === 'today') return { from: today, to: today };
  if (p === 'yesterday') { const y = addDays(today, -1); return { from: y, to: y }; }
  if (p === 'week') return { from: addDays(today, -6), to: today };
  const first = `${today.slice(0, 8)}01`;
  if (p === 'month') return { from: first, to: today };
  const last = addDays(first, -1);
  return { from: `${last.slice(0, 8)}01`, to: last };
}

const rs = (paise: number): string => (paise / 100).toFixed(2);
const csvCell = (v: string | number): string => { const t = String(v); return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; }; // a spreadsheet must never run a cell as a formula
export function toCsv(r: Report): string {
  const head = ['Date', 'Room sales', 'Food sales', 'Other sales', 'Tax', 'Collected', 'Rooms sold', 'Invoices', 'Counter bills'];
  const lines = r.days.map((d) => [d.day, rs(d.room), rs(d.food), rs(d.other), rs(d.tax), rs(d.collected), d.rooms_sold, d.invoices, d.pos_bills].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n');
}
