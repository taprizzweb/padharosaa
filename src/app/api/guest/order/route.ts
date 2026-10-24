import { NextResponse } from 'next/server';
import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { setGuestCookie } from '@/lib/guest/session-cookie';
import { orderBody } from '@/lib/schemas/guest';

export const dynamic = 'force-dynamic';

interface PlaceResult {
  order_no: number;
  total_paise: number;
  session_id: string;
  status: string;
  replayed: boolean;
}

export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: orderBody }, async (ctx, body) => {
    // Only wrong-QR-token attempts (guessing) count against an address: many honest guests share one cafe wifi IP.
    const guessKey = `tok:${ctx.ipHash}`;
    await guard(guessKey, 20, 600);
    const where = await rpc<string>('guest_check_location', { p_slug: body.slug, p_lat: body.geo?.lat ?? null, p_lng: body.geo?.lng ?? null, p_acc: body.geo?.accuracy ?? null });
    if (where === 'suspended') throw new ApiError(403, 'restaurant_suspended');
    if (where === 'required') throw new ApiError(403, 'location_required');
    if (where === 'inaccurate') throw new ApiError(403, 'location_inaccurate');
    if (where === 'too_far') throw new ApiError(403, 'too_far_from_restaurant');
    const r = await rpc<PlaceResult>('guest_place_order', {
      p_slug: body.slug,
      p_token: body.token,
      p_items: body.items.map((i) => ({ item_id: i.item_id, qty: i.qty, note: i.note || null, variant_id: i.variant_id ?? null, option_ids: i.option_ids ?? null })),
      p_note: body.note || null,
      p_idem: body.idempotency_key,
      p_ip_hash: ctx.ipHash,
    }).catch(async (e: unknown) => {
      if (e instanceof ApiError && e.key === 'invalid_table_token') await penalize(guessKey, 600);
      throw e;
    });
    // A hotel guest's choice (Room delivery or Takeaway). A hotel that does not do room delivery turns "deliver" into Takeaway, and an
    // order that is not a hotel room order simply ignores the choice: the order itself is already placed either way.
    let handover: 'deliver' | 'takeaway' | null = null;
    if (body.handover && !r.replayed) {
      const set = (mode: 'deliver' | 'takeaway') => rpc<{ handover: 'deliver' | 'takeaway' }>('guest_set_order_handover', { p_slug: body.slug, p_token: body.token, p_order_no: r.order_no, p_mode: mode, p_minutes: null });
      try {
        handover = (await set(body.handover)).handover;
      } catch (e) {
        if (body.handover === 'deliver' && e instanceof ApiError && e.key === 'invalid_input') handover = await set('takeaway').then((x) => x.handover).catch(() => null);
      }
    }
    const res = jsonOk({ order_no: r.order_no, total_paise: r.total_paise, status: r.status, replayed: r.replayed, handover }, ctx.requestId) as NextResponse;
    setGuestCookie(res, r.session_id, body.slug);
    return res;
  });
}
