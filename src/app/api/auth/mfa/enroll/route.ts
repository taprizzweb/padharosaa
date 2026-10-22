import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { mfaEnrollBody } from '@/lib/schemas/staff';

export const dynamic = 'force-dynamic';

// Starts authenticator-app setup: returns the QR picture and the typed-in key. The factor only counts once a code is verified.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: mfaEnrollBody }, async (ctx) => {
    await limit(`mfe:${ctx.userId}`, 10, 600);
    const { data: list } = await ctx.db.auth.mfa.listFactors();
    if ((list?.totp ?? []).length > 0) throw new ApiError(409, 'conflict'); // already set up: use the verify step
    // throw away abandoned, never-verified attempts so only one is ever pending
    for (const f of list?.all ?? []) if (f.status === 'unverified') await ctx.db.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await ctx.db.auth.mfa.enroll({ factorType: 'totp', issuer: 'Taprizz', friendlyName: `phone-${Date.now()}` });
    if (error || !data) throw Object.assign(new Error('mfa enroll failed'), { dbCode: String(error?.status ?? '') });
    return jsonOk({ factor_id: data.id, qr_code: data.totp.qr_code, secret: data.totp.secret }, ctx.requestId);
  });
}
