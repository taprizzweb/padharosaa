import { describe, expect, it } from 'vitest';
import { AREAS, areaHref, canOpen, homeFor, isPadHost } from '@/lib/padharosaa/areas';

describe('padharosaa role addresses', () => {
  it('everyone has exactly one home', () => {
    expect(homeFor('owner', [])).toBe('owner');
    expect(homeFor('manager', ['front_desk'])).toBe('manager');
    expect(homeFor('kitchen', ['kitchen'])).toBe('kitchen');
    expect(homeFor('waiter', ['front_desk', 'concierge'])).toBe('reception');
    expect(homeFor('waiter', ['housekeeping'])).toBe('housekeeping');
    expect(homeFor('waiter', ['maintenance'])).toBe('housekeeping');
    expect(homeFor('waiter', [])).toBe('reception');
    expect(homeFor('stranger', [])).toBeNull();
  });
  it('a role only opens its own page; owner opens all, manager all but owner, desk is shared', () => {
    for (const a of AREAS) expect(canOpen(a, 'owner', []), a).toBe(true);
    for (const a of AREAS) expect(canOpen(a, 'manager', []), a).toBe(a !== 'owner');
    expect(canOpen('kitchen', 'kitchen', [])).toBe(true);
    for (const a of ['owner', 'manager', 'reception', 'housekeeping'] as const) expect(canOpen(a, 'kitchen', []), a).toBe(false);
    expect(canOpen('housekeeping', 'waiter', ['housekeeping'])).toBe(true);
    expect(canOpen('reception', 'waiter', ['housekeeping'])).toBe(false);
    expect(canOpen('owner', 'waiter', ['front_desk'])).toBe(false);
    expect(canOpen('desk', 'waiter', ['front_desk'])).toBe(true);
    expect(canOpen('desk', 'stranger', [])).toBe(false);
  });
  it('clean addresses only on padharosaa.*', () => {
    expect(areaHref('owner', true)).toBe('/owner');
    expect(areaHref('owner', false)).toBe('/padharosaa/owner');
    expect(isPadHost('padharosaa.taprizz.in')).toBe(true);
    expect(isPadHost('menu.taprizz.in')).toBe(false);
    expect(isPadHost(null)).toBe(false);
  });
});
