// The named front doors of a Padharosaa hotel: padharosaa.<domain>/owner, /manager and /desk (the reception desk, where EVERY request and
// food order arrives), plus /kitchen for hotels that say they have a separate kitchen display. Pure rules, shared by the pages, the
// sign-in redirect and the middleware. The database still decides what each person can actually see or do; this only decides which
// page is "theirs". Reception and every other staff member also get /menu (the sold-out switches) and /settings (their own account).
export const AREAS = ['owner', 'manager', 'desk', 'billing', 'kitchen', 'menu', 'settings'] as const;
export type Area = (typeof AREAS)[number];

export const isArea = (v: string): v is Area => (AREAS as readonly string[]).includes(v);

export const AREA_TITLE: Record<Area, string> = { owner: 'Owner', manager: 'Manager', desk: 'Reception desk', billing: 'Billing', kitchen: 'Kitchen', menu: 'Menu', settings: 'Settings' };

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
  if (area === 'desk' || area === 'menu' || area === 'settings') return true; // every active staff member can open the desk (they see what their role allows)
  if (area === 'billing') return role === 'owner' || role === 'manager' || role === 'waiter'; // the database lets only the front office through
  if (area === 'kitchen') return role === 'kitchen' || role === 'owner' || role === 'manager';
  if (area === 'manager') return role === 'owner' || role === 'manager';
  return role === 'owner';
}

/** On padharosaa.* the clean address is used; anywhere else (e.g. a vercel.app preview) the full path. */
export const areaHref = (area: Area, onPadHost: boolean): string => (onPadHost ? `/${area}` : `/padharosaa/${area}`);

export const isPadHost = (host: string | null | undefined): boolean => /^padharosaa\./i.test(host ?? '');

/**
 * Which alarm a desk request plays, so the ear can tell them apart without looking: urgent (siren), a food order (chime), a guest problem
 * or help (ding-dong), housekeeping and maintenance (soft bell), and everything else (concierge, cab, wake-up...) the waiter beeps.
 */
export type DeskSound = 'urgent' | 'order' | 'help' | 'housekeeping' | 'waiter';
export const DESK_SOUND_ORDER: readonly DeskSound[] = ['urgent', 'order', 'help', 'housekeeping', 'waiter'];
export function soundForRequest(r: { urgent: boolean; type: string; team: string }): DeskSound {
  if (r.urgent) return 'urgent';
  if (r.type === 'food') return 'order';
  if (r.type === 'help') return 'help';
  if (r.team === 'housekeeping' || r.team === 'maintenance' || r.type === 'housekeeping') return 'housekeeping';
  return 'waiter';
}
/** The sounds to play for a set of requests: one of each kind, most important first. */
export const soundsFor = (rs: { urgent: boolean; type: string; team: string }[]): DeskSound[] => DESK_SOUND_ORDER.filter((k) => rs.some((r) => soundForRequest(r) === k));
