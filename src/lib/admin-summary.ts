import { expiryOf } from './billing';

// The owner-of-the-platform view: how many clients, who needs a renewal call, and what the clients pay in a month. Only adds up what the list already holds.
export interface ClientRow { status: 'active' | 'suspended'; paid_until: string | null; auto_pause: boolean; grace_days: number; price_paise: number; billing_period: 'monthly' | 'yearly' | 'one_time'; last_order_at: string | null }
export type ClientFilter = 'all' | 'active' | 'suspended' | 'renew' | 'ended' | 'quiet';
export const FILTER_LABEL: Record<ClientFilter, string> = { all: 'All', active: 'Active', suspended: 'Suspended', renew: 'Renew soon', ended: 'Ended', quiet: 'No orders for 7 days' };

const DAY = 86_400_000;
const kindOf = (r: ClientRow, now: Date) => expiryOf(r.paid_until, r.auto_pause, r.grace_days, now).kind;

export function matches(r: ClientRow, f: ClientFilter, now = new Date()): boolean {
  switch (f) {
    case 'all': return true;
    case 'active': return r.status === 'active';
    case 'suspended': return r.status === 'suspended';
    case 'renew': return r.status === 'active' && ['soon', 'grace'].includes(kindOf(r, now));
    case 'ended': return kindOf(r, now) === 'ended';
    case 'quiet': return r.status === 'active' && (!r.last_order_at || now.getTime() - new Date(r.last_order_at).getTime() > 7 * DAY);
  }
}

export function counts(rows: ClientRow[], now = new Date()): Record<ClientFilter, number> {
  const out = {} as Record<ClientFilter, number>;
  for (const f of Object.keys(FILTER_LABEL) as ClientFilter[]) out[f] = rows.filter((r) => matches(r, f, now)).length;
  return out;
}

/** What the active clients pay in a month, in paise: a yearly plan counts a twelfth, a one-time fee counts nothing */
export function monthlyRevenue(rows: ClientRow[]): number {
  return rows.filter((r) => r.status === 'active').reduce((a, r) => a + (r.billing_period === 'monthly' ? r.price_paise : r.billing_period === 'yearly' ? Math.round(r.price_paise / 12) : 0), 0);
}
