import { jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { idParam } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// One of the guest's own requests, with its updates. The tracking page polls this.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    const rid = idParam.safeParse(id);
    if (!rid.success) throw new ApiError(404, 'not_found');
    await limit(`padg:${ctx.me.session_id}`, 240, 60);
    return jsonOk(await rpc('padh_guest_get_request', { p_session: ctx.me.session_id, p_request: rid.data }), ctx.requestId);
  });
}
