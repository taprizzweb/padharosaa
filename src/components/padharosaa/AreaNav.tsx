'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export type NavCurrent = 'owner' | 'manager' | 'desk' | 'kitchen';

/** Owner and manager see every screen of the hotel: the console, the one reception desk, and the kitchen display when the hotel has one. */
export function AreaNav({ role, current, kitchenDisplay = false }: { role: string; current: NavCurrent; kitchenDisplay?: boolean }) {
  const [pad, setPad] = useState(false);
  useEffect(() => { setPad(/^padharosaa\./i.test(location.host)); }, []);
  if (role !== 'owner' && role !== 'manager') return null;
  const to = (a: string) => (pad ? `/${a}` : `/padharosaa/${a}`);
  const items: [NavCurrent, string, string][] = [
    [role as NavCurrent, role === 'owner' ? 'Owner console' : 'Manager console', to(role)],
    ['desk', 'Reception desk (everything)', to('desk')],
    ...(kitchenDisplay ? ([['kitchen', 'Kitchen display', to('kitchen')]] as [NavCurrent, string, string][]) : []),
  ];
  return (
    <nav aria-label="Screens" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map(([k, label, href]) => (
        <Link key={k} href={href} prefetch={false} aria-current={k === current ? 'page' : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold ${k === current ? 'bg-stone-900 text-white' : 'border-2 border-stone-800 text-stone-900'}`}>{label}</Link>
      ))}
    </nav>
  );
}
