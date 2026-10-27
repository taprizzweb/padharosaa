import { canOpen, type Area } from './areas';

// The side menu of the staff software: what each role sees, in groups. Pure rules; the pages and the database still decide what a person may do.
export type NavItem = { area: Area; label: string; icon: NavIcon };
export type NavGroup = { title: string; items: NavItem[] };
export type NavIcon = 'dashboard' | 'desk' | 'billing' | 'menu' | 'kitchen' | 'qr' | 'settings';

const ALL: NavItem[] = [
  { area: 'desk', label: 'Reception desk', icon: 'desk' },
  { area: 'billing', label: 'Billing', icon: 'billing' },
  { area: 'kitchen', label: 'Kitchen', icon: 'kitchen' },
  { area: 'menu', label: 'Menu', icon: 'menu' },
  { area: 'qr', label: 'QR codes', icon: 'qr' },
  { area: 'settings', label: 'Settings', icon: 'settings' },
];

/** The groups shown for a role. The kitchen entry for owner and manager appears only when the hotel has a separate kitchen display. */
export function navFor(role: string, opts: { kitchenDisplay?: boolean } = {}): NavGroup[] {
  const boss = role === 'owner' || role === 'manager';
  const pick = (areas: Area[]) => ALL.filter((i) => areas.includes(i.area) && canOpen(i.area, role) && (i.area !== 'kitchen' || role === 'kitchen' || (boss && !!opts.kitchenDisplay)));
  const groups: NavGroup[] = [];
  if (boss) groups.push({ title: 'Hotel', items: [{ area: role === 'owner' ? 'owner' : 'manager', label: 'Dashboard', icon: 'dashboard' }] });
  const work = pick(['desk', 'billing', 'kitchen']);
  if (work.length) groups.push({ title: 'Front office', items: work });
  const setup = pick(['menu', 'qr', 'settings']);
  if (setup.length) groups.push({ title: boss ? 'Setup' : 'More', items: setup });
  return groups;
}

export const titleFor = (area: string): string => ({ owner: 'Dashboard', manager: 'Dashboard', desk: 'Reception desk', billing: 'Billing', qr: 'QR codes', kitchen: 'Kitchen', menu: 'Menu', settings: 'Settings' } as Record<string, string>)[area] ?? 'Padharosaa';
