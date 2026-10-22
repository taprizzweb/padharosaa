import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { idParam } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// end | block a guest session (reception or manager).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  return staffRoute(req, { method: 'POST' }, async (ctx) => {
    const sid = idParam.safeParse(id);
    if (!sid.success || (action !== 'end' && action !== 'block')) throw new ApiError(404, 'not_found');
    await limit(`ps:${ctx.userId}`, 120, 60);
    await staffRpc(ctx.db, action === 'end' ? 'padh_end_session' : 'padh_block_session', { p_session: sid.data });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
