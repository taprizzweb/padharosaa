'use client';
import { useState } from 'react';
import { ApiFailure } from '@/lib/guest/client';
import { errorMessageKey, t } from '@/lib/i18n';
import { Alert, btnPrimary } from '@/components/guest/ui';

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password, next }),
      });
      const body = (await res.json().catch(() => null)) as { next?: string; error?: { key?: string } } | null;
      if (!res.ok) throw new ApiFailure(body?.error?.key ?? 'server_error', res.status);
      // Full page load so the server sees the new session cookie.
      window.location.assign(body?.next ?? '/staff');
    } catch (err) {
      setError(t(errorMessageKey(err instanceof ApiFailure ? err.key : 'network')));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5" data-accent="saffron">
      <label className="block text-sm font-semibold">
        Email
        <input type="email" required autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-normal" />
      </label>
      <label className="block text-sm font-semibold">
        Password
        <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-normal" />
      </label>
      {error && <Alert>{error}</Alert>}
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
