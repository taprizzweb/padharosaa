'use client';
import { useState } from 'react';
import { Alert, btnPrimary } from '@/components/guest/ui';
import { dashPostPassword } from '@/components/dash/password';

export function PasswordForm() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (a.length < 12) return setError('Your password needs at least 12 characters.');
    if (a !== b) return setError('The two passwords do not match.');
    setBusy(true);
    const err = await dashPostPassword(a);
    if (err) {
      setError(err);
      setBusy(false);
      return;
    }
    window.location.assign('/staff');
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <label className="block text-sm font-semibold">
        New password
        <input type="password" required minLength={12} autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-normal" />
      </label>
      <label className="block text-sm font-semibold">
        Type it again
        <input type="password" required minLength={12} autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base font-normal" />
      </label>
      {error && <Alert>{error}</Alert>}
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy ? 'Saving…' : 'Save password'}</button>
    </form>
  );
}
