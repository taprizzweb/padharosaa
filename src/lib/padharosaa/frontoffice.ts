// What the room chart, reservations and housekeeping screens show. Dates are YYYY-MM-DD days of the hotel; the database decides who may book what.
export type HkStatus = 'clean' | 'dirty' | 'cleaning' | 'out_of_order';
export interface ChartRoom { id: string; number: string; floor: string | null; type_id: string | null; type: string | null; rate_paise: number | null; hk_status: HkStatus; hk_note: string | null; occupied: boolean }
export type ChartBar = { kind: 'stay'; id: string; room_id: string; guest: string; from: string; to: string } | { kind: 'booking'; id: string; room_id: string | null; type_id: string | null; guest: string; from: string; to: string; seq: number };
export interface Chart { today: string; from: string; days: number; rooms: ChartRoom[]; bars: ChartBar[]; summary: { rooms: number; in_house: number; arrivals: number; departures: number; dirty: number; out_of_order: number } }
export interface Reservation {
  id: string; seq: number; guest_name: string; mobile: string | null; adults: number; check_in_on: string; check_out_on: string; rate_paise: number; advance_paise: number; advance_mode: string | null;
  source: string | null; notes: string | null; status: 'booked' | 'checked_in' | 'cancelled' | 'no_show'; cancel_reason: string | null; room_id: string | null; room: string | null; room_type_id: string | null; room_type: string | null; stay_id: string | null; nights: number;
}
export interface SearchHit { kind: 'stay' | 'booking' | 'invoice'; id: string; title: string; sub: string | null }

export const HK_LABEL: Record<HkStatus, string> = { clean: 'Clean', dirty: 'Dirty', cleaning: 'Being cleaned', out_of_order: 'Out of order' };
export const bookingNo = (seq: number): string => `B${seq}`;

const dayNo = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
export const addDays = (d: string, n: number): string => new Date((dayNo(d) + n) * 86_400_000).toISOString().slice(0, 10);

/** Where a bar sits on a chart that starts at `start` and shows `days` columns: the first column (1-based) and how many it covers, or null when it is off the chart. */
export function barSpan(from: string, to: string, start: string, days: number): { col: number; span: number } | null {
  const a = Math.max(dayNo(from) - dayNo(start), 0);
  const b = Math.min(dayNo(to) - dayNo(start), days);
  return b > a ? { col: a + 1, span: b - a } : null;
}

/** Short column heading: "Mon" and "27" */
export const dayHead = (d: string): { dow: string; dom: string } => {
  const dt = new Date(`${d}T00:00:00Z`);
  return { dow: new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(dt), dom: String(dt.getUTCDate()) };
};

/** A room that can take a guest tonight: not occupied, not out of order. (A dirty room is listed, but the desk sees it is dirty.) */
export const usableRoom = (r: ChartRoom): boolean => !r.occupied && r.hk_status !== 'out_of_order';

/** Percent of rooms in use, 0 when the hotel has none */
export const occupancy = (s: Chart['summary']): number => (s.rooms > 0 ? Math.round((s.in_house / s.rooms) * 100) : 0);

// ---- price calendar ----
export interface RateDay { day: string; rate_paise: number; custom: boolean; stop_sell: boolean; min_stay: number | null; free: number }
export interface RateCalendar { type: { id: string; name: string; base_paise: number; rooms: number }; today: string; from: string; days: RateDay[] }
export const firstOfMonth = (d: string): string => `${d.slice(0, 8)}01`;
export const monthShift = (first: string, n: number): string => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n, 1); return d.toISOString().slice(0, 10); };
export const daysInMonth = (first: string): number => { const d = new Date(`${first}T00:00:00Z`); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); };
/** blank cells before the 1st so the calendar starts on Monday: Monday = 0 ... Sunday = 6 */
export const leadingBlanks = (first: string): number => (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
export const WEEKDAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']] as const;
