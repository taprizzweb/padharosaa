import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { hoursBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: the time guest requests open and close each day. Both empty = open all day. Checked again in SQL.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: hoursBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_service_hours_set', { p_start: b.start, p_end: b.end }), ctx.requestId);
  });
}
