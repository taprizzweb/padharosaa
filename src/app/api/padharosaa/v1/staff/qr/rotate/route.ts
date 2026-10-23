import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, limit, penalize } from '@/lib/guest/rpc';
import { passwordIsRight } from '@/lib/padharosaa/reauth';
import { guestLink, newQrKey } from '@/lib/padharosaa/qrlink';
import { rotateBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner only (checked again in SQL). Printed QR codes die when this runs, so the owner's own password is asked again, with a limit on wrong tries.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: rotateBody }, async (ctx, b) => {
    await limit(`psr:${ctx.userId}`, 10, 3600);
    await guard(`qrpw:${ctx.userId}`, 5, 900);
    const { data } = await ctx.db.auth.getUser();
    const email = data.user?.email;
    if (!email || !(await passwordIsRight(email, b.password))) {
      await penalize(`qrpw:${ctx.userId}`, 900);
      throw new ApiError(401, 'invalid_credentials');
    }
    const me = await staffRpc<{ role: string; restaurant: { slug: string } }>(ctx.db, 'staff_me');
    const k = newQrKey();
    await staffRpc(ctx.db, 'padh_qr_set', { p_key_hash: k.hash, p_enc: k.enc }); // SQL refuses anyone but the owner
    return jsonOk({ link: guestLink(me.restaurant.slug, k.key) }, ctx.requestId);
  });
}
