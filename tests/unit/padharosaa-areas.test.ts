import { describe, expect, it } from 'vitest';
import { AREAS, GROUP_TEAMS, areaHref, canOpen, groupOf, homeFor, isPadHost } from '@/lib/padharosaa/areas';

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
  it('each team screen starts on its own group of teams; the board and consoles start on all', () => {
    expect(groupOf('housekeeping')).toBe('housekeeping');
    expect(GROUP_TEAMS.housekeeping).toEqual(['housekeeping', 'maintenance']);
    expect(GROUP_TEAMS.reception).toEqual(['front_desk', 'concierge']);
    expect(groupOf('kitchen')).toBe('kitchen');
    for (const a of ['desk', 'owner', 'manager'] as const) expect(GROUP_TEAMS[groupOf(a)]).toBeNull();
    // every team belongs to exactly one screen, so a manager moving between screens never loses a request
    const teams = ['concierge', 'front_desk', 'housekeeping', 'kitchen', 'maintenance', 'manager'];
    for (const t of teams) expect(['reception', 'housekeeping', 'kitchen', 'manager'].filter((g) => GROUP_TEAMS[g as 'reception']!.includes(t)).length, t).toBe(1);
  });
  it('clean addresses only on padharosaa.*', () => {
    expect(areaHref('owner', true)).toBe('/owner');
    expect(areaHref('owner', false)).toBe('/padharosaa/owner');
    expect(isPadHost('padharosaa.taprizz.in')).toBe(true);
    expect(isPadHost('menu.taprizz.in')).toBe(false);
    expect(isPadHost(null)).toBe(false);
  });
});
