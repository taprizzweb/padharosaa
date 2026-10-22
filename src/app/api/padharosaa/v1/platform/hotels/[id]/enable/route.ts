import { adminRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { rpc } from '@/lib/guest/rpc';
import { enableBody, idParam } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// Taprizz platform admin only: switches a restaurant into a Padharosaa hotel and returns its QR key (once).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRoute(req, { method: 'POST', schema: enableBody }, async (ctx, b) => {
    const rid = idParam.safeParse(id);
    if (!rid.success) throw new ApiError(404, 'not_found');
    return jsonOk(await rpc('padh_admin_enable_hotel', { p_admin: ctx.userId, p_restaurant: rid.data, p_timezone: b.timezone }), ctx.requestId);
  });
}
