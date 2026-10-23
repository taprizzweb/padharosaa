import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { guestLink, keyFromHex } from '@/lib/padharosaa/qrlink';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner and manager can always see the guest link. Making a NEW one is a separate, password-checked step (qr/rotate, owner only).
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`pqr:${ctx.userId}`, 60, 60);
    const g = await staffRpc<{ enc: string | null; rotated_at: string; role: string }>(ctx.db, 'padh_qr_get');
    const me = await staffRpc<{ restaurant: { slug: string } }>(ctx.db, 'staff_me');
    const key = keyFromHex(g.enc);
    return jsonOk({ link: key ? guestLink(me.restaurant.slug, key) : null, rotated_at: g.rotated_at, can_create: g.role === 'owner' }, ctx.requestId);
  });
}
