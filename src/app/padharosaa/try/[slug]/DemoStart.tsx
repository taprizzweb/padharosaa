'use client';

import { useState } from 'react';

export function DemoStart({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const start = async () => {
    setBusy(true); setErr(false);
    try {
      const res = await fetch(`/api/padharosaa/v1/demo/${slug}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
      const b = (await res.json().catch(() => ({}))) as { next?: string };
      if (res.ok && b.next) { window.location.assign(b.next); return; }
    } catch { /* shown below */ }
    setBusy(false); setErr(true);
  };
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => void start()} disabled={busy} className="min-h-14 w-full rounded-2xl px-6 text-lg font-extrabold text-white disabled:opacity-60" style={{ background: '#a8493c' }}>{busy ? 'Opening…' : 'Try it on this phone'}</button>
      {err && <p role="alert" className="text-sm font-semibold text-red-900">The demo could not start just now. Please try again in a moment.</p>}
    </div>
  );
}
