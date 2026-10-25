import { describe, expect, it } from 'vitest';
import { AREAS, GROUP_TEAMS, areaHref, canOpen, homeFor, isPadHost, soundForRequest, soundsFor } from '@/lib/padharosaa/areas';

describe('padharosaa addresses: owner, manager, desk (and kitchen)', () => {
  it('there are only these screens', () => expect([...AREAS]).toEqual(['owner', 'manager', 'desk', 'kitchen', 'menu', 'settings']));
  it('everyone has exactly one home; reception, concierge and housekeeping all work on the desk', () => {
    expect(homeFor('owner')).toBe('owner');
    expect(homeFor('manager')).toBe('manager');
    expect(homeFor('kitchen')).toBe('kitchen');
    expect(homeFor('waiter')).toBe('desk');
    expect(homeFor('stranger')).toBeNull();
  });
  it('the owner opens everything, the manager everything but the owner page, the kitchen its own screen and the desk, the rest only the desk', () => {
    for (const a of AREAS) expect(canOpen(a, 'owner'), a).toBe(true);
    for (const a of AREAS) expect(canOpen(a, 'manager'), a).toBe(a !== 'owner');
    expect(canOpen('kitchen', 'kitchen')).toBe(true);
    expect(canOpen('desk', 'kitchen')).toBe(true);
    expect(canOpen('manager', 'kitchen')).toBe(false);
    expect(canOpen('owner', 'kitchen')).toBe(false);
    expect(canOpen('desk', 'waiter')).toBe(true);
    for (const a of ['owner', 'manager', 'kitchen'] as const) expect(canOpen(a, 'waiter'), a).toBe(false);
    for (const a of AREAS) expect(canOpen(a, 'stranger'), a).toBe(false);
  });
  it('the filter chips group every team exactly once', () => {
    const teams = ['concierge', 'front_desk', 'housekeeping', 'kitchen', 'maintenance', 'manager'];
    for (const t of teams) expect((['reception', 'housekeeping', 'kitchen', 'manager'] as const).filter((g) => GROUP_TEAMS[g]!.includes(t)).length, t).toBe(1);
    expect(GROUP_TEAMS.all).toBeNull();
  });
  it('clean addresses only on padharosaa.*', () => {
    expect(areaHref('owner', true)).toBe('/owner');
    expect(areaHref('desk', true)).toBe('/desk');
    expect(areaHref('owner', false)).toBe('/padharosaa/owner');
    expect(isPadHost('padharosaa.taprizz.in')).toBe(true);
    expect(isPadHost('menu.taprizz.in')).toBe(false);
    expect(isPadHost(null)).toBe(false);
  });
});

describe('desk alarm sounds', () => {
  const r = (type: string, team: string, urgent = false) => ({ type, team, urgent });
  it('each kind of request has its own sound', () => {
    expect(soundForRequest(r('help', 'front_desk', true))).toBe('urgent'); // urgent beats the kind
    expect(soundForRequest(r('food', 'kitchen'))).toBe('order');
    expect(soundForRequest(r('help', 'front_desk'))).toBe('help');
    expect(soundForRequest(r('housekeeping', 'housekeeping'))).toBe('housekeeping');
    expect(soundForRequest(r('help', 'maintenance'))).toBe('help'); // a guest problem keeps the help sound even for maintenance
    expect(soundForRequest(r('cab', 'maintenance'))).toBe('housekeeping');
    expect(soundForRequest(r('cab', 'concierge'))).toBe('waiter');
  });
  it('several new requests play one sound of each kind, most important first', () => {
    expect(soundsFor([r('cab', 'concierge'), r('housekeeping', 'housekeeping'), r('help', 'front_desk', true), r('food', 'kitchen'), r('housekeeping', 'housekeeping')])).toEqual(['urgent', 'order', 'housekeeping', 'waiter']);
    expect(soundsFor([])).toEqual([]);
  });
});
