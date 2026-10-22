import { NextResponse } from 'next/server';
import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { setGuestCookie } from '@/lib/guest/session-cookie';
import { requestBody } from '@/lib/schemas/guest';

export const dynamic = 'force-dynamic';

interface RequestResult {
  session_id: string;
  request: { type: string; reason: string | null; pay_mode: string | null; status: string };
}

// Call waiter / ask for bill. Asking again is idempotent; asking for the bill again with another payment mode updates it.
export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: requestBody }, async (ctx, body) => {
    const guessKey = `tok:${ctx.ipHash}`; // shared with ordering: one budget of wrong-token guesses per address
    await guard(guessKey, 20, 600);
    const r = await rpc<RequestResult>('guest_request_by_token', {
      p_slug: body.slug,
      p_token: body.token,
      p_type: body.type,
      p_reason: body.type === 'waiter' ? body.reason : null,
      p_pay_mode: body.type === 'bill' ? body.pay_mode : null,
      p_ip_hash: ctx.ipHash,
    }).catch(async (e: unknown) => {
      if (e instanceof ApiError && e.key === 'invalid_table_token') await penalize(guessKey, 600);
      throw e;
    });
    const res = jsonOk({ request: r.request }, ctx.requestId) as NextResponse;
    setGuestCookie(res, r.session_id, body.slug);
    return res;
  });
}
