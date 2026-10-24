import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { orderEtaBody } from '@/lib/schemas/guest';

export const dynamic = 'force-dynamic';

// The guest answers the desk's "ready in N minutes": how long they will take to come (0 = "I am here now"). Only on their own table's order.
export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: orderEtaBody }, async (ctx, body) => {
    const guessKey = `tok:${ctx.ipHash}`;
    await guard(guessKey, 20, 600);
    const r = await rpc<{ guest_eta_minutes: number }>('guest_set_order_eta', { p_slug: body.slug, p_token: body.token, p_order_no: body.order_no, p_minutes: body.minutes }).catch(async (e: unknown) => {
      if (e instanceof ApiError && e.key === 'not_found') await penalize(guessKey, 600);
      throw e;
    });
    return jsonOk({ guest_eta_minutes: r.guest_eta_minutes }, ctx.requestId);
  });
}
