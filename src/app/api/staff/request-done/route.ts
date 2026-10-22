import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { requestDoneBody } from '@/lib/schemas/staff';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: requestDoneBody }, async (ctx, b) => {
    await limit(`sm:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'staff_resolve_request', { p_request_id: b.request_id }), ctx.requestId);
  });
}
