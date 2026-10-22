import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { orderStatusBody } from '@/lib/schemas/staff';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Advance an order (preparing -> ready -> served) or cancel it. The state machine and role rules live in SQL.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: orderStatusBody }, async (ctx, b) => {
    await limit(`sm:${ctx.userId}`, 120, 60);
    const r = await staffRpc(ctx.db, 'staff_set_order_status', { p_order_id: b.order_id, p_new: b.status, p_reason: b.reason ?? null });
    return jsonOk(r, ctx.requestId);
  });
}
