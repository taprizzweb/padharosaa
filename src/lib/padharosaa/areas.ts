// The named front doors of a Padharosaa hotel: padharosaa.<domain>/owner, /manager and /desk (the reception desk, where EVERY request and
// food order arrives), plus /kitchen for hotels that say they have a separate kitchen display. Pure rules, shared by the pages, the
// sign-in redirect and the middleware. The database still decides what each person can actually see or do; this only decides which
// page is "theirs".
export const AREAS = ['owner', 'manager', 'desk', 'kitchen'] as const;
export type Area = (typeof AREAS)[number];

export const isArea = (v: string): v is Area => (AREAS as readonly string[]).includes(v);

export const AREA_TITLE: Record<Area, string> = { owner: 'Owner', manager: 'Manager', desk: 'Reception desk', kitchen: 'Kitchen' };

/** Which team's requests a filter chip shows. The owner and manager see every team's requests; the desk starts on all of them. */
export type Group = 'all' | 'reception' | 'housekeeping' | 'kitchen' | 'manager';
export const GROUP_TEAMS: Record<Group, readonly string[] | null> = {
  all: null, reception: ['front_desk', 'concierge'], housekeeping: ['housekeeping', 'maintenance'], kitchen: ['kitchen'], manager: ['manager'],
};
export const GROUP_LABEL: Record<Group, string> = { all: 'All', reception: 'Reception', housekeeping: 'Housekeeping', kitchen: 'Kitchen', manager: 'Manager' };

/** Owner, manager and kitchen have their own page; everyone else on staff (reception, concierge, housekeeping...) works on the desk. */
export function homeFor(role: string): Area | null {
  if (role === 'owner' || role === 'manager' || role === 'kitchen') return role;
  if (role === 'waiter') return 'desk';
  return null;
}

export function canOpen(area: Area, role: string): boolean {
  const home = homeFor(role);
  if (!home) return false;
  if (area === 'desk') return true; // every active staff member can open the desk (they see what their role allows)
  if (area === 'kitchen') return role === 'kitchen' || role === 'owner' || role === 'manager';
  if (area === 'manager') return role === 'owner' || role === 'manager';
  return role === 'owner';
}

/** On padharosaa.* the clean address is used; anywhere else (e.g. a vercel.app preview) the full path. */
export const areaHref = (area: Area, onPadHost: boolean): string => (onPadHost ? `/${area}` : `/padharosaa/${area}`);

export const isPadHost = (host: string | null | undefined): boolean => /^padharosaa\./i.test(host ?? '');
