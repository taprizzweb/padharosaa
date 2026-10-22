import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { availabilityBody } from '@/lib/schemas/staff';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Sold-out toggle: every role may use it.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: availabilityBody }, async (ctx, b) => {
    await limit(`sm:${ctx.userId}`, 120, 60);
    const changed = await staffRpc<number>(ctx.db, 'staff_set_item_availability', { p_item_ids: b.item_ids, p_available: b.available });
    return jsonOk({ changed }, ctx.requestId);
  });
}
