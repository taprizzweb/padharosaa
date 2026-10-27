import { describe, expect, it } from 'vitest';
import { navFor } from '@/lib/padharosaa/nav';

const flat = (role: string, kd = false) => navFor(role, { kitchenDisplay: kd }).flatMap((g) => g.items.map((i) => i.area));

describe('side menu', () => {
  it('owner and manager see the dashboard first and the kitchen only with a kitchen display', () => {
    expect(flat('owner')).toEqual(['owner', 'desk', 'billing', 'menu', 'qr', 'settings']);
    expect(flat('manager', true)).toEqual(['manager', 'desk', 'billing', 'kitchen', 'menu', 'qr', 'settings']);
  });
  it('reception sees desk, billing, menu and settings only', () => {
    expect(flat('waiter')).toEqual(['desk', 'billing', 'menu', 'settings']);
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
