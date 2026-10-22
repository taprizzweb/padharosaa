'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { apiPostLogout } from './logout';

const LINKS = [
  { href: '/dash/menu', label: 'Menu' },
  { href: '/dash/tables', label: 'Tables & QR' },
  { href: '/dash/staff', label: 'Staff' },
  { href: '/dash/settings', label: 'Settings' },
  { href: '/dash/report', label: 'Report' },
  { href: '/dash/analytics', label: 'Analytics' },
  { href: '/dash/audit', label: 'Activity log' },
];

export function DashNav({ name, role, slug }: { name: string; role: string; slug: string }) {
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-extrabold">{name}</p>
          <p className="text-xs capitalize text-stone-700">{role} dashboard</p>
        </div>
        <Link href="/staff" prefetch={false} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold underline">Live screen</Link>
        <a href={`/${slug}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold underline">Guest menu</a>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await apiPostLogout();
            window.location.assign('/login');
          }}
          className="inline-flex min-h-11 items-center rounded-xl border border-stone-300 px-3 text-sm font-semibold"
        >
          Sign out
        </button>
      </div>
      <nav aria-label="Dashboard" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2">
        {LINKS.map((l) => {
          const active = path === l.href || path.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              prefetch={false}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold ${active ? 'bg-accent text-white' : 'text-stone-900 hover:bg-stone-100'}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
