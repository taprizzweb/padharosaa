import { jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';

export const dynamic = 'force-dynamic';

// Everything the guest's home screen needs in one call: the two boxes, today's buffet, links, contacts, open requests and the hotel's look.
export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 240, 60);
    return jsonOk(await rpc('padh_guest_home', { p_session: ctx.me.session_id }), ctx.requestId);
  });
}
