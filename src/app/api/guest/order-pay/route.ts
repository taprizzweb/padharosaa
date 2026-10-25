import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { orderPayBody } from '@/lib/schemas/guest';

export const dynamic = 'force-dynamic';

// A hotel guest chooses, for one of their own room orders: add it to the room receipt, or pay now with the hotel's payment QR.
export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: orderPayBody }, async (ctx, body) => {
    const guessKey = `tok:${ctx.ipHash}`;
    await guard(guessKey, 20, 600);
    const r = await rpc<{ pay_method: 'room_bill' | 'pay_now' }>('guest_set_order_pay', { p_slug: body.slug, p_token: body.token, p_order_no: body.order_no, p_method: body.method }).catch(async (e: unknown) => {
      if (e instanceof ApiError && e.key === 'not_found') await penalize(guessKey, 600);
      throw e;
    });
    return jsonOk({ pay_method: r.pay_method }, ctx.requestId);
  });
}
