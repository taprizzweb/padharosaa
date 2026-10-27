import { describe, expect, it } from 'vitest';
import { addDays, barSpan, bookingNo, dayHead, occupancy, usableRoom, type ChartRoom } from '@/lib/padharosaa/frontoffice';

describe('room chart helpers', () => {
  it('a bar covers the nights from arrival up to (not including) the departure day', () => {
    expect(barSpan('2026-11-02', '2026-11-05', '2026-11-01', 14)).toEqual({ col: 2, span: 3 });
  });
  it('a bar that started before the chart or runs past it is cut to the chart', () => {
    expect(barSpan('2026-10-28', '2026-11-03', '2026-11-01', 14)).toEqual({ col: 1, span: 2 });
    expect(barSpan('2026-11-12', '2026-11-20', '2026-11-01', 14)).toEqual({ col: 12, span: 3 });
  });
  it('a bar entirely outside the chart is not drawn', () => {
    expect(barSpan('2026-10-20', '2026-10-25', '2026-11-01', 14)).toBeNull();
    expect(barSpan('2026-12-01', '2026-12-03', '2026-11-01', 14)).toBeNull();
  });
  it('days add across a month end and a year end', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('column heading, booking number and occupancy', () => {
    expect(dayHead('2026-10-27')).toEqual({ dow: 'Tue', dom: '27' });
    expect(bookingNo(12)).toBe('B12');
    expect(occupancy({ rooms: 8, in_house: 3, arrivals: 0, departures: 0, dirty: 0, out_of_order: 0 })).toBe(38);
    expect(occupancy({ rooms: 0, in_house: 0, arrivals: 0, departures: 0, dirty: 0, out_of_order: 0 })).toBe(0);
  });
  it('an occupied or out-of-order room cannot be picked', () => {
    const r = (o: Partial<ChartRoom>): ChartRoom => ({ id: 'x', number: '1', floor: null, type_id: null, type: null, rate_paise: null, hk_status: 'clean', hk_note: null, occupied: false, ...o });
    expect(usableRoom(r({}))).toBe(true);
    expect(usableRoom(r({ occupied: true }))).toBe(false);
    expect(usableRoom(r({ hk_status: 'out_of_order' }))).toBe(false);
    expect(usableRoom(r({ hk_status: 'dirty' }))).toBe(true);
  });
});
