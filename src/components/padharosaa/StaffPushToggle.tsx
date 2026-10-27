'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/components/staff/hooks';
import { pushKeyBytes, pushSupported } from '@/lib/padharosaa/webpush-client';

type State = 'hidden' | 'off' | 'on' | 'blocked';

/**
 * "Notifications on this device": a new request or food order shows on the phone or the desktop even when this page is closed or another
 * site is open. Off by default; each device is switched on by the person who uses it.
 */
export function StaffPushToggle() {
  const [state, setState] = useState<State>('hidden');
  const [key, setKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!pushSupported()) return;
    try {
      const r = await apiGet<{ key: string | null }>('/api/padharosaa/v1/staff/push');
      if (!r.key) return; // the server cannot send push: nothing to offer
      setKey(r.key);
      if (Notification.permission === 'denied') { setState('blocked'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    } catch { /* stays hidden */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  if (state === 'hidden') return null;

  const toggle = async () => {
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (state === 'on' && existing) {
        const endpoint = existing.endpoint;
        await existing.unsubscribe();
        await apiPost('/api/padharosaa/v1/staff/push', { subscription: null, endpoint });
        setState('off');
        return;
      }
      if ((await Notification.requestPermission()) !== 'granted') { setState('blocked'); return; }
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes(key!) }));
      await apiPost('/api/padharosaa/v1/staff/push', { subscription: sub.toJSON() });
      setState('on');
      await reg.showNotification('Notifications are on', { body: 'New requests and food orders will show here, even when this page is closed.', icon: '/icons/icon-192.png', tag: 'staff-test' });
    } catch { setNote('Notifications could not be switched. Please try again.'); }
  };
  return (
    <>
      <button type="button" aria-pressed={state === 'on'} data-testid="push-toggle" disabled={state === 'blocked'} onClick={() => void toggle()}
        className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold disabled:opacity-60 ${state === 'on' ? 'border-emerald-700 bg-emerald-50 text-emerald-950' : 'border-stone-300 bg-white text-stone-900'}`}>
        <span aria-hidden>{state === 'on' ? '📲' : '📵'}</span>
        {state === 'on' ? 'Notifications are on for this device' : state === 'blocked' ? 'Notifications are blocked in this browser' : 'Get notifications on this device'}
      </button>
      {note && <span role="alert" className="text-sm font-semibold text-red-900">{note}</span>}
    </>
  );
}
