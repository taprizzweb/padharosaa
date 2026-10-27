import { describe, expect, it } from 'vitest';
import { navFor } from '@/lib/padharosaa/nav';

const flat = (role: string, kd = false) => navFor(role, { kitchenDisplay: kd }).flatMap((g) => g.items.map((i) => i.area));

describe('side menu', () => {
  it('owner and manager see the dashboard first, no menu or QR entry (those are in the console), and the kitchen only with a kitchen display', () => {
    expect(flat('owner')).toEqual(['owner', 'desk', 'rooms', 'channels', 'billing', 'pos', 'inventory', 'reports', 'settings']);
    expect(flat('manager', true)).toEqual(['manager', 'desk', 'rooms', 'channels', 'billing', 'pos', 'kitchen', 'inventory', 'reports', 'settings']);
  });
  it('reception sees desk, rooms, billing, menu and settings only', () => {
    expect(flat('waiter')).toEqual(['desk', 'rooms', 'billing', 'pos', 'menu', 'settings']);
  });
  it('the kitchen sees its own screen and the shared ones, never billing or QR', () => {
    const k = flat('kitchen');
    expect(k).toContain('kitchen');
    expect(k).not.toContain('billing');
    expect(k).not.toContain('qr');
  });
  it('a role with no home sees nothing', () => {
    expect(navFor('guest')).toEqual([]);
  });
});
