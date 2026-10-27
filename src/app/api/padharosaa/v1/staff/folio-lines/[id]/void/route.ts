import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { idParam, voidBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Cross out a wrong charge (with a reason). It stays on record but no longer counts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return staffRoute(req, { method: 'POST', schema: voidBody }, async (ctx, b) => {
    const line = idParam.safeParse(id);
    if (!line.success) throw new ApiError(404, 'not_found');
    await limit(`psc:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_folio_void', { p_line: line.data, p_reason: b.reason }), ctx.requestId);
  });
}
