import { guestRoute, jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { requireWellFormedToken, tokenHash, toBytea } from '@/lib/padharosaa/crypto';
import { readPadToken } from '@/lib/padharosaa/guest';

export const dynamic = 'force-dynamic';

// The thank-you after check-out: answers only for a session that reception ended at check-out (the cookie is still on the phone).
export async function GET(req: Request) {
  return guestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padfw:${ctx.ipHash}`, 60, 60);
    let token: string;
    try { token = requireWellFormedToken(readPadToken(req.headers)); } catch { return jsonOk({ ok: false }, ctx.requestId); }
    return jsonOk(await rpc<Record<string, unknown>>('padh_guest_farewell', { p_token_hash: toBytea(tokenHash(token)) }), ctx.requestId);
  });
}
