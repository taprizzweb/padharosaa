import { jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { messagesQuery } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// Newest first, 50 at a time; pass ?before=<created_at of the oldest message you have> for older ones.
export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    const q = messagesQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    const messages = await rpc<unknown[]>('padh_guest_list_messages', { p_session: ctx.me.session_id, p_before: q.before ?? null, p_limit: q.limit });
    return jsonOk({ messages }, ctx.requestId);
  });
}
