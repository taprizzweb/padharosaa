'use client';

import Link from 'next/link';

const ROLE_NAME: Record<string, string> = { owner: 'Owner', manager: 'Manager', waiter: 'Reception / staff', kitchen: 'Kitchen' };
const btn = 'inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-base font-bold';

/** What a reception or staff person can change about themselves: their own password, the second sign-in step and signing out. Nothing about the hotel. */
export function StaffSettings({ role, name, email }: { role: string; name: string; email: string | null }) {
  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-3 text-stone-900">
      <section className="mt-4 rounded-xl border border-stone-200 bg-white p-5" aria-label="My account">
        <h2 className="text-base font-semibold tracking-tight">My account</h2>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex gap-2"><dt className="font-semibold">Name</dt><dd>{name}</dd></div>
          {email && <div className="flex gap-2"><dt className="font-semibold">Email</dt><dd>{email}</dd></div>}
          <div className="flex gap-2"><dt className="font-semibold">Role</dt><dd>{ROLE_NAME[role] ?? role}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/account/password" prefetch={false} className={`${btn} border-2 border-stone-800`}>Change my password</Link>
          <Link href="/account/mfa" prefetch={false} className={`${btn} border-2 border-stone-800`}>Two-step sign-in</Link>
        </div>
        <p className="mt-3 text-sm text-stone-700">Forgot your password? Ask the owner to give you a new one-time password.</p>
      </section>
    </div>
  );
}
