import { jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';

export const dynamic = 'force-dynamic';

// The hotel's Jaipur guide and day plans (published items only), with the hotel's own location so the app can show distances and directions.
export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 240, 60);
    return jsonOk(await rpc('padh_guest_guide', { p_session: ctx.me.session_id }), ctx.requestId);
  });
}
