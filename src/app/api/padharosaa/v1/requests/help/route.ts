import { jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { helpBody, idempotencyKey } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// A problem report: lands on reception's board, and a WhatsApp alert is queued for the head of the matching team and of reception.
export async function POST(req: Request) {
  return padGuestRoute(req, { method: 'POST', schema: helpBody }, async (ctx, b) => {
    const key = idempotencyKey.safeParse(req.headers.get('idempotency-key'));
    if (!key.success) throw new ApiError(400, 'invalid_input');
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    const out = await rpc<Record<string, unknown>>('padh_guest_create_help', { p_session: ctx.me.session_id, p_category: b.category, p_detail: b.detail ?? null, p_urgent: b.urgent, p_idem: key.data });
    return jsonOk(out, ctx.requestId, { status: out.replayed || out.merged ? 200 : 201 });
  });
}
