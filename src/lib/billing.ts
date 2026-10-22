/** Plain helpers for plan dates and rupee inputs. No server, no database: easy to test. */

/** "2,499" or "2499.50" -> paise; null when it is not a sensible amount (empty counts as 0). */
export function rupeesToPaise(input: string): number | null {
  const v = input.replace(/[,\s₹]/g, '');
  if (v === '') return 0;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}
export const paiseToRupees = (paise: number): string => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

/** Same calendar day N months later (31 Jan + 1 month = 28/29 Feb), as YYYY-MM-DD. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The end of an Indian calendar day (23:59:59 IST) as an ISO instant; '' means "no end date". */
export const endOfDayIst = (isoDate: string): string | null => (isoDate ? new Date(`${isoDate}T23:59:59+05:30`).toISOString() : null);
export const startOfDayIst = (isoDate: string): string | null => (isoDate ? new Date(`${isoDate}T00:00:00+05:30`).toISOString() : null);
export const istDate = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : '');

export type Expiry =
  | { kind: 'none' }
  | { kind: 'active'; daysLeft: number }
  | { kind: 'soon'; daysLeft: number }
  | { kind: 'grace'; daysOver: number; graceLeft: number }
  | { kind: 'ended'; daysOver: number; paused: boolean };

export const SOON_DAYS = 15;

/** Where a restaurant stands against its end date. `paused` means the menu has stopped taking orders by itself. */
export function expiryOf(paidUntil: string | null, autoPause: boolean, graceDays: number, now = new Date()): Expiry {
  if (!paidUntil) return { kind: 'none' };
  const end = new Date(paidUntil).getTime();
  const diff = end - now.getTime();
  const day = 86400_000;
  if (diff >= 0) {
    const daysLeft = Math.ceil(diff / day);
    return daysLeft <= SOON_DAYS ? { kind: 'soon', daysLeft } : { kind: 'active', daysLeft };
  }
  const daysOver = Math.ceil(-diff / day);
  const pausedAt = end + graceDays * day;
  if (autoPause && now.getTime() <= pausedAt && graceDays > 0) return { kind: 'grace', daysOver, graceLeft: Math.ceil((pausedAt - now.getTime()) / day) };
  return { kind: 'ended', daysOver, paused: autoPause && now.getTime() > pausedAt };
}

export function describeExpiry(e: Expiry): string {
  switch (e.kind) {
    case 'none': return 'No end date';
    case 'active': return `${e.daysLeft} days left`;
    case 'soon': return e.daysLeft === 0 ? 'Ends today' : `Ends in ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'}`;
    case 'grace': return `Ended ${e.daysOver} day${e.daysOver === 1 ? '' : 's'} ago · pauses in ${e.graceLeft} day${e.graceLeft === 1 ? '' : 's'}`;
    case 'ended': return e.paused ? `Ended ${e.daysOver} day${e.daysOver === 1 ? '' : 's'} ago · menu paused` : `Ended ${e.daysOver} day${e.daysOver === 1 ? '' : 's'} ago`;
  }
}
