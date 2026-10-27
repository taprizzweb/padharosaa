import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { resetBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner only: wipe the test activity of a hotel that has been trying the system out (the word RESET is typed on the screen; the database checks it again).
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: resetBody }, async (ctx, b) => {
    await limit(`prs:${ctx.userId}`, 5, 3600);
    return jsonOk(await staffRpc(ctx.db, 'padh_reset_trial', { p_scope: b.scope, p_confirm: b.confirm }), ctx.requestId);
  });
}
