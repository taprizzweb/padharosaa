import { jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';

export const dynamic = 'force-dynamic';

// The signed-in guest's own hotel: are requests open right now, and the opening and closing time (empty = open all day).
export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 240, 60);
    return jsonOk(await rpc<{ open: boolean; start: string | null; end: string | null }>('padh_service_hours_guest', { p_session: ctx.me.session_id }), ctx.requestId);
  });
}
