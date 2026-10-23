import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { orderHandoverBody } from '@/lib/schemas/staff';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Kitchen / manager: a ROOM order goes out as room delivery or takeaway. The guest sees it on their order.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: orderHandoverBody }, async (ctx, b) => {
    await limit(`sm:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'staff_set_order_handover', { p_order_id: b.order_id, p_mode: b.mode }), ctx.requestId);
  });
}
