import { adminRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, limit, penalize, rpc } from '@/lib/guest/rpc';
import { guestLink, keyFromHex, newQrKey } from '@/lib/padharosaa/qrlink';
import { passwordIsRight } from '@/lib/padharosaa/reauth';
import { idParam, rotateBody } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

interface AdminQr { enabled: boolean; slug: string; enc: string | null; rotated_at: string }

// Platform admin: see any Padharosaa hotel's guest link at any time.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRoute(req, { method: 'GET' }, async (ctx) => {
    const rid = idParam.safeParse(id);
    if (!rid.success) throw new ApiError(404, 'not_found');
    await limit(`pqa:${ctx.userId}`, 60, 60);
    const g = await rpc<AdminQr>('padh_admin_qr_get', { p_admin: ctx.userId, p_restaurant: rid.data });
    const key = keyFromHex(g.enc);
    return jsonOk({ enabled: g.enabled, link: key ? guestLink(g.slug, key) : null, rotated_at: g.rotated_at, can_create: true }, ctx.requestId);
  });
}

// Platform admin: make a new link (all printed QR codes stop working). Needs the admin's own password.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRoute(req, { method: 'POST', schema: rotateBody }, async (ctx, b) => {
    const rid = idParam.safeParse(id);
    if (!rid.success) throw new ApiError(404, 'not_found');
    await limit(`pqa:${ctx.userId}`, 10, 3600);
    await guard(`qrpw:${ctx.userId}`, 5, 900);
    const { data } = await ctx.db.auth.getUser();
    const email = data.user?.email;
    if (!email || !(await passwordIsRight(email, b.password))) {
      await penalize(`qrpw:${ctx.userId}`, 900);
      throw new ApiError(401, 'invalid_credentials');
    }
    const cur = await rpc<AdminQr>('padh_admin_qr_get', { p_admin: ctx.userId, p_restaurant: rid.data });
    const k = newQrKey();
    await rpc('padh_admin_qr_set', { p_admin: ctx.userId, p_restaurant: rid.data, p_key_hash: k.hash, p_enc: k.enc });
    return jsonOk({ link: guestLink(cur.slug, k.key) }, ctx.requestId);
  });
}
