// The channel-manager service (Channex): what we send (prices and rooms left) and what we receive (bookings). Everything that knows the shape
// of the service's messages is in this one file, so a change on their side is a change here only. Money is whole paise (INR minor units).
export interface PushDay { day: string; rate_paise: number; stop_sell: boolean; min_stay: number | null; free: number }
export interface PushGroup { property_id: string; ext_room_type_id: string; ext_rate_plan_id: string; days: PushDay[] }
export interface NormalizedBooking {
  ext_id: string; revision: string; status: 'new' | 'modified' | 'cancelled'; channel: string; guest: string; mobile: string | null; adults: number;
  check_in: string; check_out: string; ext_room_type_id: string; rate_paise: number; notes: string | null;
}
export interface Cfg { baseUrl: string; apiKey: string }

const addDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Joins neighbouring days with the same values into one range (the service takes date_from..date_to inclusive), so a year is a handful of lines, not 366. */
export function toRanges<T extends { day: string }>(days: T[], same: (a: T, b: T) => boolean): { from: string; to: string; first: T }[] {
  const out: { from: string; to: string; first: T; last: T }[] = [];
  for (const d of days) {
    const cur = out[out.length - 1];
    if (cur && addDay(cur.to) === d.day && same(cur.first, d)) { cur.to = d.day; cur.last = d; } else out.push({ from: d.day, to: d.day, first: d, last: d });
  }
  return out.map(({ from, to, first }) => ({ from, to, first }));
}

/** The two requests for one room type: prices/closing/minimum stay (per rate plan) and rooms left (per room type). */
export function buildPush(g: PushGroup): { restrictions: Record<string, unknown>[]; availability: Record<string, unknown>[] } {
  const restrictions = toRanges(g.days, (a, b) => a.rate_paise === b.rate_paise && a.stop_sell === b.stop_sell && a.min_stay === b.min_stay).map(({ from, to, first }) => ({
    property_id: g.property_id, rate_plan_id: g.ext_rate_plan_id, date_from: from, date_to: to, rate: first.rate_paise, stop_sell: first.stop_sell, min_stay_arrival: first.min_stay ?? 1,
  }));
  const availability = toRanges(g.days, (a, b) => a.free === b.free).map(({ from, to, first }) => ({
    property_id: g.property_id, room_type_id: g.ext_room_type_id, date_from: from, date_to: to, availability: first.free,
  }));
  return { restrictions, availability };
}

export class ChannelError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ChannelError'; }
}

async function call(cfg: Cfg, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}${path}`, { method, headers: { 'user-api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) throw new ChannelError(`The channel service answered ${res.status}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`, res.status);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof ChannelError) throw e;
    throw new ChannelError(e instanceof Error && e.name === 'AbortError' ? 'The channel service did not answer in time' : 'The channel service could not be reached', 0);
  } finally { clearTimeout(t); }
}

const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function pushGroup(cfg: Cfg, g: PushGroup): Promise<void> {
  const { restrictions, availability } = buildPush(g);
  for (const values of chunk(restrictions, 100)) await call(cfg, 'POST', '/restrictions', { values });
  for (const values of chunk(availability, 100)) await call(cfg, 'POST', '/availability', { values });
}

/** The property's name, or an error: used when the owner presses "Test the connection". */
export async function testProperty(cfg: Cfg, propertyId: string): Promise<string> {
  const r = (await call(cfg, 'GET', `/properties/${encodeURIComponent(propertyId)}`)) as { data?: { attributes?: { title?: string } } };
  return r.data?.attributes?.title ?? 'Connected';
}

export async function registerWebhook(cfg: Cfg, propertyId: string, callbackUrl: string): Promise<void> {
  await call(cfg, 'POST', '/webhooks', { webhook: { property_id: propertyId, callback_url: callbackUrl, event_mask: 'booking', request_params: {}, headers: {}, is_active: true, send_data: false } });
}

// ---- bookings ----
const rupeesToPaise = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/**
 * One revision from the service's booking feed -> one line per booked room (a booking of two rooms is two reservations, "BOOKING#0" and "BOOKING#1").
 * Anything that does not look right is skipped, never guessed: the revision is then left un-acknowledged and shows up as an error.
 */
export function normalizeRevision(rev: unknown): NormalizedBooking[] {
  const r = rev as { id?: unknown; attributes?: Record<string, any> } | null; // eslint-disable-line @typescript-eslint/no-explicit-any -- the service's JSON, checked field by field below
  const a = r?.attributes;
  if (!r || !a || typeof r.id !== 'string') return [];
  const status = a.status === 'cancelled' ? 'cancelled' : a.status === 'modified' ? 'modified' : a.status === 'new' ? 'new' : null;
  const bookingId = str(a.booking_id ?? a.unique_id, 100);
  const rooms: any[] = Array.isArray(a.rooms) ? a.rooms : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!status || !bookingId || rooms.length === 0) return [];
  const channel = str(a.ota_name, 40) || 'Booking site';
  const cust = a.customer ?? {};
  const guest = [str(cust.name, 40), str(cust.surname, 40)].filter(Boolean).join(' ');
  const out: NormalizedBooking[] = [];
  rooms.forEach((room, i) => {
    const arrival = str(room.checkin_date ?? a.arrival_date, 10), departure = str(room.checkout_date ?? a.departure_date, 10);
    const nights = Math.max(1, Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86_400_000));
    const total = room.amount !== undefined ? rupeesToPaise(room.amount) : Math.round(rupeesToPaise(a.amount) / rooms.length);
    const code = str(a.ota_reservation_code, 40);
    out.push({
      ext_id: `${bookingId}#${i}`, revision: r.id as string, status, channel, guest: guest || `Guest (${channel})`, mobile: str(cust.phone, 20) || null,
      adults: Math.max(1, Math.min(20, Number(room.occupancy?.adults ?? 1) || 1)), check_in: arrival, check_out: departure, ext_room_type_id: str(room.room_type_id, 64),
      rate_paise: Math.round(total / nights), notes: code ? `${channel} booking ${code}` : null,
    });
  });
  return out;
}

export async function fetchFeed(cfg: Cfg, propertyId: string): Promise<unknown[]> {
  const r = (await call(cfg, 'GET', `/booking_revisions/feed?filter[property_id]=${encodeURIComponent(propertyId)}&pagination[limit]=50`)) as { data?: unknown[] };
  return Array.isArray(r.data) ? r.data : [];
}
export async function ackRevision(cfg: Cfg, id: string): Promise<void> {
  await call(cfg, 'POST', `/booking_revisions/${encodeURIComponent(id)}/ack`, {});
}
