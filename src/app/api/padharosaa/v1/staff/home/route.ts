import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { homeBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Manager / owner: the two boxes on the guests' home screen.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: homeBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    await staffRpc(ctx.db, 'padh_set_home', { p_offer: b.offer ?? null, p_offer_until: b.offer_until ?? null, p_info: b.info ?? null });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
