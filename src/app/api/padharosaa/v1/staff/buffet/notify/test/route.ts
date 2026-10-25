import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { pushToHotel } from '@/lib/padharosaa/push';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager / reception: send a test alert to every guest phone that allowed alerts, and say exactly what happened.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST' }, async (ctx) => {
    await limit(`pst:${ctx.userId}`, 10, 60);
    const me = await staffRpc<{ restaurant: { id: string; name: string; slug: string } }>(ctx.db, 'staff_me');
    const r = await pushToHotel(me.restaurant.id, { title: `${me.restaurant.name}: test alert`, body: 'This is a test from the front desk. Buffet alerts are working on this phone.', url: `/padharosaa/${me.restaurant.slug}`, tag: 'buffet-test' });
    return jsonOk(r, ctx.requestId);
  });
}
