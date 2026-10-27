import { jsonOk } from '@/lib/api/route';
import { later } from '@/lib/padharosaa/push';
import { notifyStaffOfRequest } from '@/lib/padharosaa/staff-push';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { createRequestBody, idempotencyKey } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 240, 60);
    return jsonOk({ requests: await rpc<unknown[]>('padh_guest_list_requests', { p_session: ctx.me.session_id }) }, ctx.requestId);
  });
}

// Creating something needs an Idempotency-Key header: retries (bad network) return the original, never a duplicate.
export async function POST(req: Request) {
  return padGuestRoute(req, { method: 'POST', schema: createRequestBody }, async (ctx, b) => {
    const key = idempotencyKey.safeParse(req.headers.get('idempotency-key'));
    if (!key.success) throw new ApiError(400, 'invalid_input');
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    const out = await rpc<Record<string, unknown>>('padh_guest_create_request', {
      p_session: ctx.me.session_id,
      p_type: b.type,
      p_label: b.label,
      p_detail: b.detail ?? null,
      p_urgent: b.urgent,
      p_idem: key.data,
    });
    if (!out.replayed && !out.merged && typeof out.request_id === 'string') later(() => notifyStaffOfRequest(out.request_id as string)); // tell the team's phones, after the answer has gone
    return jsonOk(out, ctx.requestId, { status: out.replayed || out.merged ? 200 : 201 });
  });
}
