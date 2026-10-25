'use client';

import { useEffect, useState } from 'react';
import type { Copy } from './copy';
import { api } from './shared';

const toKey = (b64: string) => { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (ch) => ch.charCodeAt(0)); };

/** Guest: allow buffet alerts on this phone (Web Push). Hidden when the phone or the server cannot do it. */
export function BuffetAlerts({ c }: { c: Copy }) {
  const [state, setState] = useState<'hidden' | 'off' | 'on' | 'blocked'>('hidden');
  const [key, setKey] = useState<string | null>(null);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported && !iphone) return;
      const r = await api<{ key: string | null }>('push');
      if (!alive || !r.ok || !r.data.key) return;
      setKey(r.data.key);
      if (!supported) { setIos(true); setState('off'); return; }
      if (Notification.permission === 'denied') { setState('blocked'); return; }
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.getSubscription();
        if (alive) setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
      } catch { if (alive) setState('off'); }
    })();
    return () => { alive = false; };
  }, []);
  if (state === 'hidden') return null;
  const toggle = async () => {
    if (ios) { alert(c.alertsHint); return; }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (state === 'on' && existing) { await existing.unsubscribe(); await api('push', { method: 'POST', body: JSON.stringify({ subscription: null }) }); setState('off'); return; }
      if ((await Notification.requestPermission()) !== 'granted') { setState('blocked'); return; }
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key!) }));
      const r = await api('push', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      setState(r.ok ? 'on' : 'off');
    } catch { setState('off'); }
  };
  return (
    <button type="button" onClick={() => void toggle()} data-testid="buffet-alerts" aria-pressed={state === 'on'} disabled={state === 'blocked'} className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-2 text-left text-sm font-semibold" style={{ background: 'rgba(255,255,255,.92)', color: '#1f2937', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }}>
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: state === 'on' ? '#DDEFE2' : '#ECE9E4' }}>{state === 'on' ? '🔔' : '🔕'}</span>
      <span className="flex-1">{state === 'on' ? c.alertsOn : state === 'blocked' ? c.alertsBlocked : c.alertsAsk}</span>
      {state !== 'blocked' && <span aria-hidden className="relative h-6 w-11 shrink-0 rounded-full transition" style={{ background: state === 'on' ? '#1F6B3E' : '#c9c4bb' }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" style={{ left: state === 'on' ? '1.4rem' : '0.15rem' }} /></span>}
    </button>
  );
}
