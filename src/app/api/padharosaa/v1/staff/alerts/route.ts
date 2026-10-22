import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { alertBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Everyone: which teams' alerts I have muted for myself (and whether the hotel serves room dining).
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_my_alerts'), ctx.requestId);
  });
}
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: alertBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_set_my_alert', { p_team: b.team, p_muted: b.muted }), ctx.requestId);
  });
}
