import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { autoBillBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: put every room food order on the room receipt automatically. Checked again in SQL.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: autoBillBody }, async (ctx, b) => {
    await limit(`psa:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_set_auto_room_bill', { p_on: b.on }), ctx.requestId);
  });
}
