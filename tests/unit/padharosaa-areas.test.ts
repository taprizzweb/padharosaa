import { describe, expect, it } from 'vitest';
import { COPY, isHelpLabel, localLabel } from '@/components/padharosaa/copy';
import { AREAS, GROUP_TEAMS, areaHref, canOpen, homeFor, isPadHost, soundForRequest, soundsFor } from '@/lib/padharosaa/areas';

describe('padharosaa addresses: owner, manager, desk (and kitchen)', () => {
  it('there are only these screens', () => expect([...AREAS]).toEqual(['owner', 'manager', 'desk', 'billing', 'qr', 'kitchen', 'menu', 'settings']));
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
    expect(canOpen('billing', 'waiter')).toBe(true); // the database then lets only the front office through
    expect(canOpen('billing', 'kitchen')).toBe(false);
    expect(canOpen('qr', 'waiter')).toBe(false); // printing the codes is for the owner and manager
    expect(canOpen('qr', 'kitchen')).toBe(false);
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

describe('request titles in the guest\'s language', () => {
  it('known titles are translated, unknown ones are left as they are', () => {
    expect(localLabel('Wake-up call', COPY.hi)).toBe(COPY.hi.types.wake);
    expect(localLabel('Housekeeping: Extra towels', COPY.fr)).toBe(`${COPY.fr.types.housekeeping}: ${COPY.fr.hk[0]}`);
    expect(localLabel('AC or electrical, Noise', COPY.de)).toBe(`${COPY.de.helpCats.ac_electrical}, ${COPY.de.helpCats.noise}`);
    expect(localLabel('Something the hotel wrote', COPY.es)).toBe('Something the hotel wrote');
    expect(localLabel('Wake-up call', COPY.en)).toBe('Wake-up call');
  });
  it('a problem report is told apart from a service', () => {
    expect(isHelpLabel('AC or electrical, Noise')).toBe(true);
    expect(isHelpLabel('Cab')).toBe(false);
    expect(isHelpLabel('Housekeeping: Extra towels')).toBe(false);
  });
  it('every language has every line (no blank screen for a French or German guest)', () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v).map((x) => `${k}.${x}`) : [k]));
    const base = keys(COPY.en).sort();
    for (const l of ['hi', 'fr', 'es', 'de'] as const) expect(keys(COPY[l]).sort(), l).toEqual(base);
  });
});
