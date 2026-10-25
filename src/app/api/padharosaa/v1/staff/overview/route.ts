import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: today at a glance (guests, requests, how fast they are answered, orders, busy hours, the last seven days).
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_overview'), ctx.requestId);
  });
}
