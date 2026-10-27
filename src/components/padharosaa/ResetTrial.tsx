'use client';

import { useState } from 'react';
import { apiPost } from '@/components/staff/hooks';
import { Card, ns } from '@/components/ui/ns';

interface Result { requests: number; orders: number; guest_logins: number; stays: number; bookings: number; counter_bills: number }

/** For a hotel that has been trying the system: wipe the test requests, orders and (if asked) check-ins and bills, and start clean. Owner only. */
export function ResetTrial({ onDone }: { onDone: () => void }) {
  const [scope, setScope] = useState<'activity' | 'everything'>('activity');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { setRes(await apiPost<Result>('/api/padharosaa/v1/staff/reset', { scope, confirm: 'RESET' })); setWord(''); onDone(); } catch { setErr('That did not go through. Only the owner can clear test data.'); }
    setBusy(false);
  };
  return (
    <Card title="Start clean" hint="Trying the system out? Clear the test data here. Your rooms, prices, taxes, team, menu and settings stay.">
      <fieldset className="space-y-2" aria-label="What to clear">
        {([['activity', 'Guest requests, food orders and guest logins'], ['everything', 'All of that, and also check-ins, bills, invoices, bookings and counter bills (numbering starts from 1 again)']] as const).map(([k, l]) => (
          <label key={k} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${scope === k ? 'border-indigo-900 bg-indigo-50' : 'border-stone-300'}`}><input type="radio" name="reset-scope" className="mt-1" checked={scope === k} onChange={() => setScope(k)} /><span>{l}</span></label>
        ))}
      </fieldset>
      <label className="mt-3 block text-sm font-semibold">Type RESET to confirm<input className={ns.input} value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} /></label>
      <button type="button" className={`${ns.danger} mt-3`} disabled={word !== 'RESET' || busy} onClick={() => void go()}>{busy ? 'Clearing…' : 'Clear the test data'}</button>
      {err && <p role="alert" className="mt-2 text-sm font-semibold text-red-800">{err}</p>}
      {res && <p role="status" className="mt-2 text-sm font-semibold text-emerald-900" data-testid="reset-done">Cleared: {res.requests} requests, {res.orders} orders, {res.guest_logins} guest logins{res.stays ? `, ${res.stays} check-ins` : ''}{res.bookings ? `, ${res.bookings} bookings` : ''}{res.counter_bills ? `, ${res.counter_bills} counter bills` : ''}.</p>}
    </Card>
  );
}
