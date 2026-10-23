import { jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { idempotencyKey, planAddBody, planRemoveBody, planUseBody } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// The guest's own day plan: add | remove | use (copy an itinerary) | send (to the concierge, as one request).
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return padGuestRoute(req, { method: 'POST' }, async (ctx, raw) => {
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    const p_session = ctx.me.session_id;
    switch (action) {
      case 'add': {
        const b = planAddBody.parse(raw);
        return jsonOk(await rpc('padh_guest_plan_add', { p_session, p_name: b.name, p_when: b.when_label ?? null, p_maps_query: b.maps_query ?? null, p_lat: b.lat ?? null, p_lng: b.lng ?? null }), ctx.requestId);
      }
      case 'remove':
        return jsonOk(await rpc('padh_guest_plan_remove', { p_session, p_item: planRemoveBody.parse(raw).item }), ctx.requestId);
      case 'use':
        return jsonOk(await rpc('padh_guest_plan_use', { p_session, p_itinerary: planUseBody.parse(raw).itinerary }), ctx.requestId);
      case 'send': {
        const key = idempotencyKey.safeParse(req.headers.get('idempotency-key'));
        if (!key.success) throw new ApiError(400, 'invalid_input');
        return jsonOk(await rpc('padh_guest_plan_send', { p_session, p_idem: key.data }), ctx.requestId, { status: 201 });
      }
      default:
        throw new ApiError(404, 'not_found');
    }
  });
}
