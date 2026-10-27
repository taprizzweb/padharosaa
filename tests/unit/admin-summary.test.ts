import { describe, expect, it } from 'vitest';
import { counts, matches, monthlyRevenue, type ClientRow } from '@/lib/admin-summary';

const now = new Date('2026-10-27T10:00:00Z');
const iso = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
const row = (o: Partial<ClientRow>): ClientRow => ({ status: 'active', paid_until: iso(90), auto_pause: false, grace_days: 0, price_paise: 100000, billing_period: 'monthly', last_order_at: iso(-1), ...o });

describe('platform client list', () => {
  it('finds who to call for a renewal: ends within 15 days, or ended but still in its grace days', () => {
    expect(matches(row({ paid_until: iso(10) }), 'renew', now)).toBe(true);
    expect(matches(row({ paid_until: iso(60) }), 'renew', now)).toBe(false);
    expect(matches(row({ paid_until: iso(-1), auto_pause: true, grace_days: 5 }), 'renew', now)).toBe(true);
    expect(matches(row({ paid_until: iso(-10) }), 'ended', now)).toBe(true);
    expect(matches(row({ status: 'suspended', paid_until: iso(5) }), 'renew', now)).toBe(false);
  });
  it('quiet clients: no order for a week, or never', () => {
    expect(matches(row({ last_order_at: iso(-8) }), 'quiet', now)).toBe(true);
    expect(matches(row({ last_order_at: null }), 'quiet', now)).toBe(true);
    expect(matches(row({ last_order_at: iso(-2) }), 'quiet', now)).toBe(false);
  });
  it('counts per filter, and monthly revenue counts only active clients: yearly as a twelfth, one-time as nothing', () => {
    const rows = [row({}), row({ status: 'suspended' }), row({ billing_period: 'yearly', price_paise: 1200000 }), row({ billing_period: 'one_time', price_paise: 5000000 })];
    expect(counts(rows, now)).toMatchObject({ all: 4, active: 3, suspended: 1 });
    expect(monthlyRevenue(rows)).toBe(100000 + 100000);
  });
});
