import 'server-only';
import { serverEnv } from '@/env';
import { rpc } from '@/lib/guest/rpc';
import { later } from './push';
import { ackRevision, fetchFeed, normalizeRevision, pushGroup, type Cfg, type PushGroup } from './channex';

/** The channel service's address and key, or null when the server has no key (then nothing is sent and the console says so). */
export function channelCfg(): Cfg | null {
  const env = serverEnv();
  return env.CHANNEX_API_KEY ? { baseUrl: env.CHANNEX_BASE_URL, apiKey: env.CHANNEX_API_KEY } : null;
}

interface Claimed extends PushGroup { restaurant_id: string; ids: number[] }
const msg = (e: unknown): string => (e instanceof Error ? e.message : 'Unknown error').slice(0, 280);

/** Sends the waiting price and room changes. Each group is marked done or failed on its own, so one bad room type does not hold back the rest. */
export async function runChannelPush(limit = 50): Promise<number> {
  const cfg = channelCfg();
  if (!cfg) return 0;
  let sent = 0;
  try {
    const groups = await rpc<Claimed[]>('padh_channel_claim', { p_limit: limit });
    for (const g of groups) {
      try { await pushGroup(cfg, g); await rpc('padh_channel_done', { p_rid: g.restaurant_id, p_ids: JSON.stringify(g.ids), p_error: null }); sent++; }
      catch (e) { await rpc('padh_channel_done', { p_rid: g.restaurant_id, p_ids: JSON.stringify(g.ids), p_error: msg(e) }).catch(() => undefined); }
    }
  } catch { /* the database or the service is down: the changes stay queued and the next tick tries again */ }
  return sent;
}

/** Reads new bookings for one hotel. A revision is acknowledged only after it is saved (or is one we deliberately skip), so nothing is lost or entered twice. */
export async function pullHotel(restaurantId: string, propertyId: string): Promise<number> {
  const cfg = channelCfg();
  if (!cfg) return 0;
  let applied = 0;
  let problem: string | null = null;
  try {
    for (const rev of await fetchFeed(cfg, propertyId)) {
      const lines = normalizeRevision(rev);
      const id = (rev as { id?: string })?.id;
      if (lines.length === 0) { problem = 'Booking skipped: a message from the channel service could not be read'; continue; }
      let ok = true;
      for (const l of lines) {
        const r = await rpc<{ action: string }>('padh_channel_booking_apply', { p_rid: restaurantId, p_payload: JSON.stringify({ ...l }) }).catch(() => null);
        if (!r) { ok = false; problem = 'Booking not saved: please check the dates and the linked room types'; }
        else if (r.action === 'unmapped') { ok = false; problem = 'Booking not saved: its room type is not linked in the channel settings'; }
        else applied++;
      }
      if (ok && id) await ackRevision(cfg, id);
    }
  } catch (e) { problem = `Booking check failed: ${msg(e)}`; }
  await rpc('padh_channel_pulled', { p_rid: restaurantId, p_error: problem }).catch(() => undefined);
  return applied;
}

/** Cron tick: send what is waiting, and look for bookings in hotels not looked at for ten minutes (the webhook normally makes this instant). */
export async function channelTick(): Promise<{ sent: number; pulled: number }> {
  if (!channelCfg()) return { sent: 0, pulled: 0 };
  const sent = await runChannelPush();
  let pulled = 0;
  try { for (const h of await rpc<{ restaurant_id: string; property_id: string }[]>('padh_channel_pull_due', { p_stale_minutes: 10 })) pulled += await pullHotel(h.restaurant_id, h.property_id); } catch { /* next tick */ }
  return { sent, pulled };
}

let lastKick = 0;
/** After a staff change that may move prices or rooms: send soon, without making the person wait. At most once every few seconds per server. */
export function kickChannels(now: number = Date.now()): void {
  if (!channelCfg() || now - lastKick < 3000) return;
  lastKick = now;
  later(() => runChannelPush(20));
}
