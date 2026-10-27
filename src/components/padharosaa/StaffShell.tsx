'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/ui/ns';
import { navFor, titleFor, type NavIcon } from '@/lib/padharosaa/nav';
import { AlarmControl } from './AlarmControl';
import { GlobalSearch } from './GlobalSearch';

const PATHS: Record<NavIcon, string> = {
  dashboard: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  desk: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2m6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z',
  rooms: 'M3 20V8l9-5 9 5v12h-6v-6H9v6zM7 10v2h2v-2zm8 0v2h2v-2z',
  inventory: 'M20 8 12 3 4 8v10l8 4 8-4zm-8 2.2L7.5 8 12 5.8 16.5 8zM6 9.7l5 2.5v7l-5-2.5zm7 9.5v-7l5-2.5v7z',
  billing: 'M6 2h12a1 1 0 0 1 1 1v19l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1m2 5v2h8V7zm0 4v2h8v-2z',
  menu: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z',
  kitchen: 'M6 2v8a3 3 0 0 0 2 2.8V22h2V12.8A3 3 0 0 0 12 10V2h-2v6H9V2H7v6H6V2zm10 0c-2 1.5-3 4-3 7v4h3v9h2V2z',
  qr: 'M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm9-2h2v2h-2zm4 0h3v2h-3zm-4 4h2v4h-2zm4 1h3v3h-3z',
  settings: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7',
};
const Icon = ({ k }: { k: NavIcon }) => <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-current"><path d={PATHS[k]} /></svg>;

/**
 * The staff software frame: a dark side menu on a wide screen (a scrolling strip on a phone), a top bar with the page name, the date and the
 * alarm, and the page itself. The alarm lives in the frame, so it keeps ringing and showing what is waiting on every screen.
 */
export function StaffShell({ role, hotel, name, current, kitchenDisplay, children }: { role: string; hotel: string; name: string; current: string; kitchenDisplay: boolean; children: ReactNode }) {
  const [pad, setPad] = useState(false);
  useEffect(() => { setPad(/^padharosaa\./i.test(location.host)); }, []);
  const to = (a: string) => (pad ? `/${a}` : `/padharosaa/${a}`);
  const groups = navFor(role, { kitchenDisplay });
  const signOut = async () => { try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'local' }) }); } finally { window.location.assign('/login'); } };
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  const frontOffice = groups.some((g) => g.items.some((i) => i.area === 'billing'));
  const isCurrent = (a: string) => a === current;
  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900 lg:flex" data-testid="staff-shell">
      <aside className="bg-[#111827] text-slate-200 print:hidden lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:overflow-y-auto">
        <div className="flex items-center gap-3 px-4 py-3 lg:py-5">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500 text-sm font-bold text-white">{hotel.trim().charAt(0).toUpperCase() || 'H'}</span>
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{hotel}</p><p className="text-[11px] uppercase tracking-[.14em] text-slate-400">Padharosaa</p></div>
        </div>
        <nav aria-label="Screens" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-5 lg:overflow-visible lg:pb-6">
          {groups.map((g) => (
            <div key={g.title} className="flex shrink-0 gap-1 lg:block lg:space-y-1">
              <p className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-[.14em] text-slate-500 lg:block">{g.title}</p>
              {g.items.map((i) => (
                <Link key={i.area} href={to(i.area)} prefetch={false} aria-current={isCurrent(i.area) ? 'page' : undefined}
                  className={`flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-medium ${isCurrent(i.area) ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
                  <Icon k={i.icon} />{i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5 print:hidden">
          <div className="min-w-0 sm:flex-1"><h1 className="truncate text-lg font-semibold tracking-tight">{titleFor(current)}</h1><p className="text-xs text-stone-500">{today}</p></div>
          {frontOffice && <GlobalSearch to={to} />}
          <span className="hidden truncate text-sm text-stone-600 lg:block">{name}</span>
          <ThemeToggle />
          <button type="button" onClick={() => void signOut()} className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-3 text-sm font-semibold text-stone-700">Sign out</button>
        </header>
        <div className="px-4 pt-1 print:hidden"><AlarmControl onDesk={current === 'desk'} deskHref={to('desk')} /></div>
        <main>{children}</main>
      </div>
    </div>
  );
}
