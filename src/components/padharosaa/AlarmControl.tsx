'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { alarm, useAlarm } from '@/components/staff/alarm-center';

/**
 * The alarm switch and the "waiting" banner, on every staff screen. The alarm keeps ringing when the person moves between screens, so what
 * is waiting is shown on all of them with a way back to the desk.
 */
export function AlarmControl({ onDesk, deskHref }: { onDesk: boolean; deskHref: string }) {
  const a = useAlarm();
  useEffect(() => { alarm?.init(); }, []);
  const urgent = a.waiting.some((w) => w.urgent);
  return (
    <div className="mt-3" data-testid="alarm-control">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={a.on} data-testid="alarm-toggle"
          onClick={() => void (a.on ? alarm.disable() : alarm.enable())}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold ${a.on ? 'border-emerald-700 bg-emerald-700 text-white' : a.needsTap ? 'animate-pulse border-red-700 bg-red-700 text-white' : 'border-stone-300 bg-white text-stone-900'}`}>
          <span aria-hidden>{a.on ? '🔔' : '🔕'}</span>{a.on ? 'Alarm is on' : a.needsTap ? 'Tap to turn the alarm back on' : 'Alarm is off: tap to turn it on'}
        </button>
        {a.on && <button type="button" className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold" onClick={() => alarm.play('urgent')}>Test the sound</button>}
      </div>
      {a.on && a.waiting.length > 0 && (
        <div role="alert" data-testid="alarm-banner" className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-sm font-semibold text-white ${urgent ? 'animate-pulse bg-red-700' : 'bg-amber-700'}`}>
          <span><b>{a.waiting.length} waiting</b> · {a.text}</span>
          {!onDesk && <Link href={deskHref} prefetch={false} className="rounded-lg bg-white px-3 py-1.5 text-red-900">Open the desk</Link>}
        </div>
      )}
    </div>
  );
}
