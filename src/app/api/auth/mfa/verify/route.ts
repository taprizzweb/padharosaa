import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize } from '@/lib/guest/rpc';
import { mfaVerifyBody } from '@/lib/schemas/staff';

export const dynamic = 'force-dynamic';

// Checks the 6-digit code (finishing setup the first time). On success the session becomes aal2 and its cookie is refreshed.
// Only WRONG codes count against the limit: 5 per 10 minutes per account (a 6-digit code must not be guessable).
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: mfaVerifyBody }, async (ctx, body) => {
    const key = `mfv:${ctx.userId}`;
    await guard(key, 5, 600);
    const { data: list } = await ctx.db.auth.mfa.listFactors();
    if (!(list?.all ?? []).some((f) => f.id === body.factor_id)) throw new ApiError(404, 'not_found');
    const { data: ch, error: e1 } = await ctx.db.auth.mfa.challenge({ factorId: body.factor_id });
    if (e1 || !ch) throw new ApiError(400, 'invalid_input');
    const { error: e2 } = await ctx.db.auth.mfa.verify({ factorId: body.factor_id, challengeId: ch.id, code: body.code });
    if (e2) {
      await penalize(key, 600);
      throw new ApiError(401, 'invalid_credentials');
    }
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
