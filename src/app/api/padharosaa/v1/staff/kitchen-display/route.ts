import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { kitchenDisplayBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Manager / owner: does this hotel have a separate kitchen display? When on, the kitchen gets its own screen; the desk still sees everything.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: kitchenDisplayBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_set_kitchen_display', { p_on: b.kitchen_display }), ctx.requestId);
  });
}
