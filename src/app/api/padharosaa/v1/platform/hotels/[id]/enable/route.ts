import { createHash } from 'node:crypto';
import { adminRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { rpc } from '@/lib/guest/rpc';
import { encryptText, toBytea } from '@/lib/padharosaa/crypto';
import { enableBody, idParam } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// Taprizz platform admin only: switches a restaurant into a Padharosaa hotel and returns its QR key (once).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRoute(req, { method: 'POST', schema: enableBody }, async (ctx, b) => {
    const rid = idParam.safeParse(id);
    if (!rid.success) throw new ApiError(404, 'not_found');
    const out = await rpc<{ restaurant_id: string; qr_key: string | null }>('padh_admin_enable_hotel', { p_admin: ctx.userId, p_restaurant: rid.data, p_timezone: b.timezone });
    // keep an encrypted copy of a brand-new key too, so the link can be shown again later (the plain key is still returned here once)
    if (out.qr_key) await rpc('padh_admin_qr_set', { p_admin: ctx.userId, p_restaurant: rid.data, p_key_hash: toBytea(createHash('sha256').update(out.qr_key, 'utf8').digest()), p_enc: toBytea(encryptText(out.qr_key)) });
    return jsonOk(out, ctx.requestId);
  });
}
