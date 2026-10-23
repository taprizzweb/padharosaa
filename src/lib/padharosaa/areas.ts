// The named front doors of a Padharosaa hotel (padharosaa.<domain>/owner, /manager, /kitchen, /reception, /housekeeping, /desk).
// Pure rules, shared by the pages, the sign-in redirect and the middleware. The database still decides what each person
// can actually see or do; this only decides which page is "theirs".
export const AREAS = ['owner', 'manager', 'kitchen', 'reception', 'housekeeping', 'desk'] as const;
export type Area = (typeof AREAS)[number];

/** Which teams each screen is about. The owner and manager see every team's requests everywhere; these decide what a screen starts on. */
export type Group = 'all' | 'reception' | 'housekeeping' | 'kitchen' | 'manager';
export const GROUP_TEAMS: Record<Group, readonly string[] | null> = {
  all: null, reception: ['front_desk', 'concierge'], housekeeping: ['housekeeping', 'maintenance'], kitchen: ['kitchen'], manager: ['manager'],
};
export const GROUP_LABEL: Record<Group, string> = { all: 'All', reception: 'Reception', housekeeping: 'Housekeeping', kitchen: 'Kitchen', manager: 'Manager' };
export const groupOf = (a: Area): Group => (a === 'reception' || a === 'housekeeping' || a === 'kitchen' ? a : 'all');

export const isArea = (v: string): v is Area => (AREAS as readonly string[]).includes(v);

export const AREA_TITLE: Record<Area, string> = {
  owner: 'Owner', manager: 'Manager', kitchen: 'Kitchen', reception: 'Reception', housekeeping: 'Housekeeping', desk: 'Padharosaa desk',
};

/** teams = what the database says this person may act on (padh_my_alerts().teams), e.g. ['housekeeping','maintenance'] */
export function homeFor(role: string, teams: readonly string[]): Area | null {
  if (role === 'owner') return 'owner';
  if (role === 'manager') return 'manager';
  if (role === 'kitchen') return 'kitchen';
  if (role === 'waiter') {
    const front = teams.some((t) => t === 'front_desk' || t === 'concierge');
    const house = teams.some((t) => t === 'housekeeping' || t === 'maintenance');
    return house && !front ? 'housekeeping' : 'reception';
  }
  return null;
}

export function canOpen(area: Area, role: string, teams: readonly string[]): boolean {
  if (area === 'desk') return homeFor(role, teams) !== null; // every active staff member has the shared board
  if (role === 'owner') return true;
  if (role === 'manager') return area !== 'owner';
  return homeFor(role, teams) === area;
}

/** On padharosaa.* the clean address is used; anywhere else (e.g. a vercel.app preview) the full path. */
export const areaHref = (area: Area, onPadHost: boolean): string => (onPadHost ? `/${area}` : `/padharosaa/${area}`);

export const isPadHost = (host: string | null | undefined): boolean => /^padharosaa\./i.test(host ?? '');
