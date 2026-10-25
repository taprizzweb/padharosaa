import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { buffetNotifyBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager / reception: tell guests' phones when the buffet is saved, and the daily reminder time (empty = no reminder).
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: buffetNotifyBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_buffet_notify_set', { p_time: b.time || null, p_on_save: b.onSave }), ctx.requestId);
  });
}
