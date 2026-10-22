import { jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharoso/guest';
import { guestActionBody, idParam } from '@/lib/padharoso/schemas';

export const dynamic = 'force-dynamic';

// Guest actions on their own request: cancel (only while received) and "is everything okay now?" (confirm).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return padGuestRoute(req, { method: 'POST', schema: guestActionBody }, async (ctx, body) => {
    const rid = idParam.safeParse(id);
    if (!rid.success || (action !== 'cancel' && action !== 'confirm')) throw new ApiError(404, 'not_found');
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    if (action === 'cancel') {
      return jsonOk(await rpc('padh_guest_cancel_request', { p_session: ctx.me.session_id, p_request: rid.data }), ctx.requestId);
    }
    if (typeof body.ok !== 'boolean') throw new ApiError(400, 'invalid_input');
    return jsonOk(await rpc('padh_guest_confirm_resolved', { p_session: ctx.me.session_id, p_request: rid.data, p_ok: body.ok }), ctx.requestId);
  });
}
