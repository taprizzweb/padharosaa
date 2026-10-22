import { jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharoso/guest';

export const dynamic = 'force-dynamic';

// Phone numbers are returned only to a logged-in guest, never on the public login page.
export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    return jsonOk(await rpc('padh_guest_contacts', { p_session: ctx.me.session_id }), ctx.requestId);
  });
}
