import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { rotateBody } from '@/lib/padharoso/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner/manager only (checked in SQL). The body must contain the typed word ROTATE. The new key is shown once.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: rotateBody }, async (ctx, b) => {
    await limit(`psr:${ctx.userId}`, 5, 3600);
    return jsonOk(await staffRpc(ctx.db, 'padh_rotate_qr_key', { p_confirm: b.confirm }), ctx.requestId);
  });
}
