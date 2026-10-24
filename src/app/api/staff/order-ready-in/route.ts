import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { orderReadyInBody } from '@/lib/schemas/staff';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Desk / kitchen: "your takeaway will be ready in N minutes". The guest then replies how long they will take to reach the desk.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: orderReadyInBody }, async (ctx, b) => {
    await limit(`sm:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'staff_set_order_ready_in', { p_order_id: b.order_id, p_minutes: b.minutes }), ctx.requestId);
  });
}
