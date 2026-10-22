import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { guestSessionFrom } from '@/lib/guest/session-cookie';
import { slugParam } from '@/lib/schemas/guest';

export const dynamic = 'force-dynamic';

// Polled by the guest's phone. Requires the signed cookie issued when they first ordered or called the waiter.
export async function GET(req: Request) {
  return guestRoute(req, { method: 'GET' }, async (ctx) => {
    const session = guestSessionFrom(req.headers);
    const slug = slugParam.safeParse(new URL(req.url).searchParams.get('slug'));
    if (!session || !slug.success || session.slug !== slug.data) throw new ApiError(401, 'unauthorized');
    // Per session (not per IP): many guests share one cafe wifi address.
    await limit(`st:${session.sessionId}`, 40, 60);
    const status = await rpc<Record<string, unknown>>('guest_get_status', { p_session_id: session.sessionId, p_thankyou_minutes: 30 });
    return jsonOk(status, ctx.requestId);
  });
}
