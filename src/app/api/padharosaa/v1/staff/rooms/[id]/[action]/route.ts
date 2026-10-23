import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { idParam, roomActiveBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// stay-code: a new 4-digit code (shown once, never stored in readable form). checkout: ends the room's sessions and retires its code.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return staffRoute(req, { method: 'POST', schema: action === 'active' ? roomActiveBody : undefined }, async (ctx, body) => {
    const room = idParam.safeParse(id);
    if (!room.success || (action !== 'stay-code' && action !== 'checkout' && action !== 'active')) throw new ApiError(404, 'not_found');
    await limit(`ps:${ctx.userId}`, 120, 60);
    if (action === 'active') {
      await staffRpc(ctx.db, 'padh_rooms_set_active', { p_room: room.data, p_active: (body as { active: boolean }).active });
      return jsonOk({ ok: true }, ctx.requestId);
    }
    const out = await staffRpc(ctx.db, action === 'stay-code' ? 'padh_issue_stay_code' : 'padh_checkout_room', action === 'stay-code' ? { p_room: room.data } : { p_room: room.data });
    return jsonOk(out, ctx.requestId);
  });
}
