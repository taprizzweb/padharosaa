import { formatPaise } from '@/lib/money';

// What the billing screens show. Every amount arrives from the database as whole paise; nothing here adds up a bill (the database does).
export interface FolioLine { src: 'room' | 'order' | 'manual' | 'extra'; description: string; qty: number; unit_paise: number | null; amount_paise: number; tax_bp: number; sac: string | null; at: string; order_id?: string | null; line_id?: string | null }
export interface TaxGroup { tax_bp: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; tax_paise: number }
export interface Payment { id: string; kind: 'advance' | 'payment' | 'refund'; mode: string; amount_paise: number; ref: string | null; at: string }
export interface Folio {
  stay: { id: string; status: 'in_house' | 'checked_out'; guest_name: string; mobile: string | null; adults: number; company_name: string | null; company_gstin: string | null; address: string | null; inter_state: boolean;
    room: string; room_type: string | null; check_in_at: string; check_out_on: string; checked_out_at: string | null; nights: number; rate_paise: number };
  lines: FolioLine[]; tax_groups: TaxGroup[]; subtotal_paise: number; tax_paise: number; round_off_paise: number; total_paise: number; payments: Payment[]; paid_paise: number; balance_paise: number;
}
export interface FolioResponse { folio: Folio; invoice: { number: string; issued_at: string } | null; lines?: { id: string; description: string; qty: number; unit_paise: number; posted_at: string }[]; removed_items?: { item_id: string; name: string; qty: number; unit_paise: number; order_no: number }[]; skipped_orders?: { order_id: string; order_no: number; total_paise: number; reason: string }[] }
export interface InvoiceResponse { number: string; issued_at: string; hotel: { name: string; legal_name: string | null; gstin: string | null; address: string | null; terms: string | null }; folio: Folio }

/** ₹1,234.50 with Indian digit grouping, always two decimals (invoices) */
export function rupees2(paise: number): string {
  const s = formatPaise(paise);
  if (!/\.\d\d$/.test(s)) return `${s}.00`;
  return s;
}
/** 500 -> "5%", 250 -> "2.5%" */
export const pct = (bp: number): string => `${Number.isInteger(bp / 100) ? bp / 100 : (bp / 100).toFixed(2).replace(/0$/, '')}%`;
/** "5%" typed as 5 or 2.5 -> basis points, or null when it is not a rate between 0 and 100 */
export function parsePercent(text: string): number | null {
  const t = text.trim().replace(/%$/, '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const bp = Math.round(parseFloat(t) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}
/** the day (YYYY-MM-DD) n days from today in the hotel's time zone */
export function dayFromToday(n: number, now: Date = new Date(), tz = 'Asia/Kolkata'): string {
  const base = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** whole nights between two YYYY-MM-DD days (at least 1) */
export const nightsBetween = (from: string, to: string): number => Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
export const dateLabel = (iso: string | null | undefined, tz = 'Asia/Kolkata'): string => (iso ? new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)) : '—');

export const PAY_MODES = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['bank', 'Bank transfer'], ['company', 'Bill to company']] as const;
export const payModeLabel = (m: string): string => PAY_MODES.find(([k]) => k === m)?.[1] ?? m;

export interface BillingSetup {
  settings: { legal_name: string | null; gstin: string | null; address: string | null; prefix: string; terms: string | null; round_off: boolean };
  room_types: { id: string; name: string; rate_paise: number; max_guests: number; active: boolean }[];
  rooms: { id: string; number: string; room_type_id: string | null; active: boolean }[];
  tax_rates: { id: string; name: string; rate_bp: number; active: boolean }[];
  categories: { id: string; kind: 'room' | 'food' | 'other'; name: string; sac: string | null; tax_rate_id: string | null; active: boolean }[];
  slabs: { up_to_paise: number | null; tax_rate_id: string }[];
  extras: { id: string; name: string; mode: 'percent' | 'per_night' | 'flat'; value: number; applies_to: 'room' | 'food' | 'all'; tax_rate_id: string | null; active: boolean }[];
}
export interface StayRow { id: string; room: string; guest_name: string; company_name: string | null; check_in_at: string; checked_out_at: string | null; status: string; rate_paise: number; nights: string; check_out_on: string; total_paise: number; paid_paise: number; balance_paise: number; invoice_number: string | null }

/** true when no charge has a tax yet: the bills would show no tax, so the screens say so */
export const taxesMissing = (s: BillingSetup): boolean => s.tax_rates.length === 0 || (!s.categories.some((c) => c.tax_rate_id) && s.slabs.length === 0);
