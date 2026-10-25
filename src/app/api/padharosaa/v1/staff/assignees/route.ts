import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Reception, manager, owner: the people a request can be handed to.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk({ people: await staffRpc(ctx.db, 'padh_assignees') }, ctx.requestId);
  });
}
