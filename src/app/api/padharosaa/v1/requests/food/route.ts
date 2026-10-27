import { jsonOk } from '@/lib/api/route';
import { later } from '@/lib/padharosaa/push';
import { notifyStaffOfRequest } from '@/lib/padharosaa/staff-push';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { foodBody, idempotencyKey } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// A food order for the kitchen's buzzer. The kitchen then chooses room delivery or takeaway and the guest is told.
export async function POST(req: Request) {
  return padGuestRoute(req, { method: 'POST', schema: foodBody }, async (ctx, b) => {
    const key = idempotencyKey.safeParse(req.headers.get('idempotency-key'));
    if (!key.success) throw new ApiError(400, 'invalid_input');
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    const out = await rpc<Record<string, unknown>>('padh_guest_create_food', { p_session: ctx.me.session_id, p_label: b.label, p_detail: b.detail ?? null, p_idem: key.data });
    if (!out.replayed && !out.merged && typeof out.request_id === 'string') later(() => notifyStaffOfRequest(out.request_id as string)); // tell the team's phones, after the answer has gone
    return jsonOk(out, ctx.requestId, { status: out.replayed ? 200 : 201 });
  });
}
