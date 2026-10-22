import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`si:${ctx.userId}`, 30, 60);
    return jsonOk({ items: await staffRpc(ctx.db, 'staff_list_items') }, ctx.requestId);
  });
}
