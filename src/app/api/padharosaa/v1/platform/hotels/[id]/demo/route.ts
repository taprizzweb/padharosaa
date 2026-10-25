import { adminRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { rpc } from '@/lib/guest/rpc';
import { demoBody, idParam } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// Taprizz platform admin only: switch the public demo of a hotel on or off. On: anyone with the demo link can try the guest app, no sign-in.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return adminRoute(req, { method: 'POST', schema: demoBody }, async (ctx, b) => {
    const rid = idParam.safeParse(id);
    if (!rid.success) throw new ApiError(404, 'not_found');
    return jsonOk(await rpc('padh_admin_set_demo', { p_admin: ctx.userId, p_restaurant: rid.data, p_on: b.on }), ctx.requestId);
  });
}
