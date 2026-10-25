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

export function DashNav({ name, role, slug, support = false, menuLocked = false }: { name: string; role: string; slug: string; support?: boolean; menuLocked?: boolean }) {
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white print:hidden">
      {support && (
        <div role="status" data-testid="support-banner" className="flex flex-wrap items-center justify-center gap-3 bg-indigo-900 px-4 py-2 text-sm font-semibold text-white">
          <span>You are editing {name} as Taprizz admin.</span>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await fetch('/api/admin/menu-leave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } finally { window.location.assign('/admin'); } }} className="min-h-11 rounded-xl bg-white px-4 font-bold text-indigo-950">Leave and go back to the admin panel</button>
        </div>
      )}
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
        {LINKS.filter((l) => !(menuLocked && l.href === '/dash/menu')).map((l) => {
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
