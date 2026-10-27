import 'server-only';
import { after } from 'next/server';
import webpush from 'web-push';
import { serverEnv } from '@/env';
import { rpc } from '@/lib/guest/rpc';

export interface PushResult { configured: boolean; targets: number; sent: number; dropped: number; failed: number; codes: number[] }
export interface BuffetToday { slug: string; hotel: string; name: string | null; start: string; end: string; venue: string | null; restaurant_id?: string }
export interface Target { id: string; sub: webpush.PushSubscription }

export function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const e = serverEnv();
  return e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY ? { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT ?? 'mailto:support@taprizz.in' } : null;
}

const clock12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`; };

/** The words on the phone. `kind` is "saved" (just announced) or "reminder" (the daily one). */
export function buffetMessage(b: BuffetToday, kind: 'saved' | 'reminder'): { title: string; body: string; url: string; tag: string } {
  const what = [b.name, `${clock12(b.start)} – ${clock12(b.end)}`, b.venue].filter(Boolean).join(' · ');
  return { title: kind === 'saved' ? `${b.hotel}: buffet today` : `${b.hotel}: buffet tonight`, body: what, url: `/padharosaa/${b.slug}`, tag: `buffet-${b.slug}` };
}

/** Sends one message to a list of devices. A device that has gone (410/404) is passed to `drop`. Never throws. */
export async function deliver(targets: Target[], msg: object, drop: (id: string) => Promise<unknown>, o: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; send?: typeof webpush.sendNotification; tag?: string; restaurant?: string } = {}): Promise<PushResult> {
  const out: PushResult = { configured: true, targets: targets.length, sent: 0, dropped: 0, failed: 0, codes: [] };
  const keys = vapid();
  if (!keys) return { ...out, configured: false };
  const send = o.send ?? webpush.sendNotification;
  const payload = JSON.stringify(msg);
  const opts = { vapidDetails: keys, TTL: o.ttl ?? 6 * 3600, urgency: o.urgency ?? ('normal' as const) };
  try {
    for (let i = 0; i < targets.length; i += 25) {
      await Promise.all(targets.slice(i, i + 25).map(async (t) => {
        try { await send(t.sub, payload, opts); out.sent++; } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { out.dropped++; await drop(t.id).catch(() => undefined); } else { out.failed++; out.codes.push(code ?? 0); }
        }
      }));
    }
  } catch { out.failed++; out.codes.push(0); }
  console.warn(JSON.stringify({ msg: 'push_sent', restaurant: o.restaurant, tag: o.tag, ...out }));
  return out;
}

/** Sends one message to every phone of a hotel that allowed it. A phone that has gone (410/404) is forgotten. Never throws. */
export async function pushToHotel(restaurantId: string, msg: { title: string; body: string; url: string; tag: string }, send: typeof webpush.sendNotification = webpush.sendNotification): Promise<PushResult> {
  if (!vapid()) return { configured: false, targets: 0, sent: 0, dropped: 0, failed: 0, codes: [] };
  let targets: Target[] = [];
  try { targets = await rpc<Target[]>('padh_push_targets', { p_restaurant: restaurantId }); } catch { return { configured: true, targets: 0, sent: 0, dropped: 0, failed: 1, codes: [0] }; }
  return deliver(targets, msg, (id) => rpc('padh_push_drop', { p_session: id }), { send, tag: msg.tag, restaurant: restaurantId });
}

/** The daily reminders that are due now (each hotel once a day, claimed in the database). Cheap when nothing is due. */
export async function runBuffetReminders(): Promise<number> {
  if (!vapid()) return 0;
  try {
    const due = await rpc<BuffetToday[]>('padh_buffet_reminders_claim');
    for (const b of due) if (b.restaurant_id) await pushToHotel(b.restaurant_id, buffetMessage(b, 'reminder'));
    return due.length;
  } catch { return 0; }
}

/** Runs work after the response has been sent. Outside a request (tests, scripts) the work is simply skipped: it is only ever a courtesy message. */
export function later(work: () => Promise<unknown>): void {
  try { after(work); } catch { /* not inside a request */ }
}
