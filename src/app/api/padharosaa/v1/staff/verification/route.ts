import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { verificationBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: does a guest need the stay code from reception to sign in? Checked again in SQL.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: verificationBody }, async (ctx, b) => {
    await limit(`psv:${ctx.userId}`, 30, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_set_verification', { p_level: b.level }), ctx.requestId);
  });
}
