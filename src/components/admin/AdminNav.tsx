'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isPadHost } from '@/lib/padharosaa/areas';
import { apiPostLogout } from '@/components/dash/logout';

export function AdminNav() {
  const [busy, setBusy] = useState(false);
  const [pad, setPad] = useState(false);
  useEffect(() => { setPad(isPadHost(window.location.host)); }, []);
  const path = usePathname();
  const link = (href: string, label: string) => (
    <Link href={href} prefetch={false} aria-current={path === href ? 'page' : undefined} className={`inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold ${path === href ? 'bg-accent text-white' : 'text-stone-900 hover:bg-stone-100'}`}>{label}</Link>
  );
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <p className="mr-auto text-base font-extrabold">Taprizz <span className="font-semibold text-stone-700">Platform admin</span></p>
        <nav aria-label="Admin" className="flex gap-1">{link('/admin', pad ? 'Hotels' : 'Restaurants')}{link('/admin/plans', 'Plans')}</nav>
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
    </header>
  );
}
