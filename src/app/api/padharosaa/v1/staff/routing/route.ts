import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { routingBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: who gets each team's requests directly on their own display.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk({ routing: await staffRpc(ctx.db, 'padh_routing_get') }, ctx.requestId);
  });
}
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: routingBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_routing_set', { p_team: b.team, p_user: b.user }), ctx.requestId);
  });
}
