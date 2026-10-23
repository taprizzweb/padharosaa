import { jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { feedbackBody, guestActionBody, idParam } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// Guest actions on their own request: cancel (only while received), "is everything okay now?" (confirm) and "How was it?" (feedback).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return padGuestRoute(req, { method: 'POST' }, async (ctx, raw) => {
    const rid = idParam.safeParse(id);
    if (!rid.success || (action !== 'cancel' && action !== 'confirm' && action !== 'feedback')) throw new ApiError(404, 'not_found');
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    if (action === 'feedback') {
      return jsonOk(await rpc('padh_guest_feedback', { p_session: ctx.me.session_id, p_request: rid.data, p_rating: feedbackBody.parse(raw).rating }), ctx.requestId);
    }
    const body = guestActionBody.parse(raw);
    if (action === 'cancel') {
      return jsonOk(await rpc('padh_guest_cancel_request', { p_session: ctx.me.session_id, p_request: rid.data }), ctx.requestId);
    }
    if (typeof body.ok !== 'boolean') throw new ApiError(400, 'invalid_input');
    return jsonOk(await rpc('padh_guest_confirm_resolved', { p_session: ctx.me.session_id, p_request: rid.data, p_ok: body.ok }), ctx.requestId);
  });
}
