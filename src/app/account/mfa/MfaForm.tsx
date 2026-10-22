'use client';
import { useState } from 'react';
import { Alert, btnPrimary } from '@/components/guest/ui';

async function post<T>(path: string, data: unknown): Promise<{ ok: boolean; status: number; key?: string; body: T | null }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(data) });
    const body = (await res.json().catch(() => null)) as (T & { error?: { key?: string } }) | null;
    return { ok: res.ok, status: res.status, key: body?.error?.key, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export function MfaForm({ factorId, next }: { factorId: string | null; next: string }) {
  const [factor, setFactor] = useState<string | null>(factorId);
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    const r = await post<{ factor_id: string; qr_code: string; secret: string }>('/api/auth/mfa/enroll', {});
    setBusy(false);
    if (r.status === 401) return window.location.assign('/login');
    if (!r.ok || !r.body) return setError('We could not start the setup. Please try again.');
    setFactor(r.body.factor_id);
    setSetup({ qr: r.body.qr_code, secret: r.body.secret });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !factor) return;
    setBusy(true);
    setError(null);
    const r = await post('/api/auth/mfa/verify', { factor_id: factor, code });
    if (r.ok) return window.location.assign(next);
    setBusy(false);
    setCode('');
    if (r.key === 'unauthorized') return window.location.assign('/login');
    setError(r.key === 'rate_limited' ? 'Too many wrong codes. Please wait a few minutes and try again.' : r.status === 0 ? 'No connection. Please try again.' : 'That code is not right. Codes change every 30 seconds, so try the newest one.');
  }

  const codeField = (
    <form onSubmit={submit} className="mt-6 space-y-5">
      <label className="block text-sm font-semibold">
        6-digit code
        <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-center text-xl font-normal tracking-[0.3em]" />
      </label>
      {error && <Alert>{error}</Alert>}
      <button type="submit" disabled={busy || code.length !== 6} className={`${btnPrimary} w-full`}>{busy ? 'Checking…' : 'Confirm'}</button>
    </form>
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10" data-accent="saffron">
      <h1 className="text-3xl font-extrabold">Two-step sign-in</h1>
      {factorId ? (
        <>
          <p className="mt-2 text-stone-700">Open your authenticator app and type the 6-digit code for Taprizz.</p>
          {codeField}
        </>
      ) : !setup ? (
        <>
          <p className="mt-2 text-stone-700">Platform administrators must protect their account with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…). It takes one minute.</p>
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          <button type="button" onClick={start} disabled={busy} className={`${btnPrimary} mt-6 w-full`}>Set up authenticator app</button>
        </>
      ) : (
        <>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-stone-800">
            <li>Open your authenticator app and add an account.</li>
            <li>Scan this picture, or type the key below.</li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code to scan with your authenticator app" width={200} height={200} className="mx-auto mt-4 h-48 w-48 rounded-lg border border-stone-200 bg-white p-1" />
          <p className="mt-3 text-center text-sm text-stone-700">Or type this key: <span className="break-all font-mono font-semibold" data-testid="mfa-secret">{setup.secret}</span></p>
          {codeField}
        </>
      )}
    </main>
  );
}
