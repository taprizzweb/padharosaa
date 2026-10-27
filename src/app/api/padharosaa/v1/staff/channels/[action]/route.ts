import type { ZodTypeAny } from 'zod';
import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { channelCfg, kickChannels, pullHotel } from '@/lib/padharosaa/channels';
import { registerWebhook, testProperty, ChannelError } from '@/lib/padharosaa/channex';
import { channelMapBody, channelSaveBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

interface Status { link: { property_id: string | null; enabled: boolean; webhook_secret: string } | null }

// Owner and manager: the channel manager's settings and status.
export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    if (action !== 'status') throw new ApiError(404, 'not_found');
    await limit(`pch:${ctx.userId}`, 120, 60);
    const s = await staffRpc<Record<string, unknown> & Status>(ctx.db, 'padh_channel_get');
    const origin = new URL(req.url).origin;
    return jsonOk({ ...s, server_ready: channelCfg() !== null, webhook_url: s.link ? `${origin}/api/padharosaa/v1/channel/webhook/${s.link.webhook_secret}` : null }, ctx.requestId);
  });
}

// save: property id and on/off. map: link a room type. resync: send the next year again. test: check the property id with the service.
// webhook: tell the service our address. pull: look for bookings now.
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const schema: ZodTypeAny | undefined = action === 'save' ? channelSaveBody : action === 'map' ? channelMapBody : undefined;
  if (!['save', 'map', 'resync', 'test', 'webhook', 'pull'].includes(action)) return staffRoute(req, { method: 'POST' }, async () => { throw new ApiError(404, 'not_found'); });
  return staffRoute(req, { method: 'POST', schema }, async (ctx, body) => {
    await limit(`pcw:${ctx.userId}`, 60, 60);
    const b = (body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- checked by the schema of this action
    if (action === 'save') { const r = await staffRpc(ctx.db, 'padh_channel_save', { p_property: b.property_id ?? null, p_enabled: b.enabled }); kickChannels(); return jsonOk(r, ctx.requestId); }
    if (action === 'map') { const r = await staffRpc(ctx.db, 'padh_channel_map', { p_type: b.type, p_ext_room: b.ext_room_type_id ?? null, p_ext_rate: b.ext_rate_plan_id ?? null }); kickChannels(); return jsonOk(r, ctx.requestId); }
    if (action === 'resync') { const r = await staffRpc(ctx.db, 'padh_channel_resync'); kickChannels(Date.now() + 10_000); return jsonOk(r, ctx.requestId); }
    // the remaining actions talk to the service, using what the hotel has saved
    const cfg = channelCfg();
    if (!cfg) throw new ApiError(503, 'channel_unavailable');
    const s = await staffRpc<Status & { link: { property_id: string | null } | null }>(ctx.db, 'padh_channel_get');
    const prop = s.link?.property_id;
    if (!prop || !s.link) throw new ApiError(400, 'invalid_input');
    try {
      if (action === 'test') return jsonOk({ name: await testProperty(cfg, prop) }, ctx.requestId);
      if (action === 'webhook') { await registerWebhook(cfg, prop, `${new URL(req.url).origin}/api/padharosaa/v1/channel/webhook/${s.link.webhook_secret}`); return jsonOk({ ok: true }, ctx.requestId); }
      const rid = await staffRpc<{ restaurant: { id: string } } | null>(ctx.db, 'staff_me');
      if (!rid) throw new ApiError(403, 'forbidden');
      return jsonOk({ applied: await pullHotel(rid.restaurant.id, prop) }, ctx.requestId);
    } catch (e) {
      if (e instanceof ChannelError) throw new ApiError(502, 'channel_unavailable');
      throw e;
    }
  });
}
