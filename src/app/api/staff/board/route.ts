import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Polled every 5 s by each staff screen (and as a safety net when realtime is connected).
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`sb:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'staff_get_board'), ctx.requestId);
  });
}
