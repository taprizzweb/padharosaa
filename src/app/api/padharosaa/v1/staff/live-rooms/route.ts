import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Reception, manager, owner: every room with a guest, its open requests and orders, and the amount not yet settled.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk({ rooms: await staffRpc(ctx.db, 'padh_live_rooms') }, ctx.requestId);
  });
}
