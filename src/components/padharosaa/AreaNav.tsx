'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export type NavCurrent = 'owner' | 'manager' | 'desk' | 'kitchen' | 'menu' | 'settings';

/** Owner and manager see every screen of the hotel: the console, the one reception desk, and the kitchen display when the hotel has one. */
export function AreaNav({ role, current, kitchenDisplay = false }: { role: string; current: NavCurrent; kitchenDisplay?: boolean }) {
  const [pad, setPad] = useState(false);
  useEffect(() => { setPad(/^padharosaa\./i.test(location.host)); }, []);
  const to = (a: string) => (pad ? `/${a}` : `/padharosaa/${a}`);
  // reception and the rest of the staff: their working screen, the menu (sold-out switches) and their own settings, nothing else
  const staffItems: [NavCurrent, string, string][] = [['desk', 'Desk', to('desk')], ['menu', 'Menu', to('menu')], ['settings', 'Settings', to('settings')]];
  const items: [NavCurrent, string, string][] = role !== 'owner' && role !== 'manager' ? (role === 'waiter' ? staffItems : []) : [
    [role as NavCurrent, role === 'owner' ? 'Owner console' : 'Manager console', to(role)],
    ['desk', 'Reception desk (everything)', to('desk')],
    ['menu', 'Menu (sold-out switches)', to('menu')],
    ...(kitchenDisplay ? ([['kitchen', 'Kitchen display', to('kitchen')]] as [NavCurrent, string, string][]) : []),
  ];
  if (items.length === 0) return null;
  const signOut = async () => { try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'local' }) }); } finally { window.location.assign('/login'); } };
  return (
    <nav aria-label="Screens" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map(([k, label, href]) => (
        <Link key={k} href={href} prefetch={false} aria-current={k === current ? 'page' : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3.5 text-sm font-semibold ${k === current ? 'bg-indigo-900 text-white' : 'border border-stone-300 bg-white text-stone-800'}`}>{label}</Link>
      ))}
      {current !== 'settings' && <button type="button" onClick={() => void signOut()} className="ml-auto inline-flex min-h-11 shrink-0 items-center rounded-lg border border-stone-300 px-3.5 text-sm font-semibold text-stone-700">Sign out</button>}
    </nav>
  );
}
