import { describe, expect, it } from 'vitest';
import { range, toCsv, totals, type Report } from '@/lib/padharosaa/reports';

const day = (o: Partial<Report['days'][0]>): Report['days'][0] => ({ day: '2026-10-01', room: 0, food: 0, other: 0, tax: 0, invoices: 0, pos_bills: 0, rooms_sold: 0, collected: 0, ...o });
const rep: Report = { from: '2026-10-01', to: '2026-10-02', rooms: 10, by_mode: {}, days: [day({ room: 600000, food: 100000, other: 20000, tax: 36000, rooms_sold: 2, collected: 500000 }), day({ day: '2026-10-02', room: 300000, rooms_sold: 1 })] };

describe('report figures', () => {
  it('adds the days up: sales, occupancy, average rate and revenue per available room', () => {
    const t = totals(rep);
    expect(t).toMatchObject({ sales: 1020000, room: 900000, tax: 36000, collected: 500000, roomsSold: 3, roomNights: 20, occupancyPct: 15 });
    expect(t.adr).toBe(300000); // 9,000 of room sales over 3 rooms sold
    expect(t.revpar).toBe(45000); // 9,000 over 20 room-nights
  });
  it('no rooms or no sales never divide by zero', () => {
    expect(totals({ from: 'a', to: 'b', rooms: 0, by_mode: {}, days: [day({})] })).toMatchObject({ occupancyPct: 0, adr: 0, revpar: 0 });
  });
  it('ranges: today, yesterday, a week, this month and last month, across month ends', () => {
    expect(range('today', '2026-10-27')).toEqual({ from: '2026-10-27', to: '2026-10-27' });
    expect(range('yesterday', '2026-11-01')).toEqual({ from: '2026-10-31', to: '2026-10-31' });
    expect(range('week', '2026-10-27')).toEqual({ from: '2026-10-21', to: '2026-10-27' });
    expect(range('month', '2026-10-27')).toEqual({ from: '2026-10-01', to: '2026-10-27' });
    expect(range('lastmonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('the spreadsheet file has rupees with two decimals and never starts a cell with a formula sign', () => {
    const csv = toCsv({ ...rep, days: [day({ day: '=cmd', room: 123456 })] });
    expect(csv.split('\n')[1]).toBe("'=cmd,1234.56,0.00,0.00,0.00,0.00,0,0,0");
  });
});
