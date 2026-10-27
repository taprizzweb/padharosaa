import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { idParam } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// One guest's bill. ?checkout=1 shows what it comes to if the guest leaves today.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    const stay = idParam.safeParse(id);
    if (!stay.success) throw new ApiError(404, 'not_found');
    await limit(`psb:${ctx.userId}`, 120, 60);
    const checkout = new URL(req.url).searchParams.get('checkout') === '1';
    return jsonOk(await staffRpc(ctx.db, 'padh_folio', { p_stay: stay.data, p_checkout: checkout }), ctx.requestId);
  });
}
