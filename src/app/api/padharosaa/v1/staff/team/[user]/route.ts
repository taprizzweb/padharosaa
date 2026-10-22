import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { idParam, profileBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ user: string }> }) {
  const { user } = await params;
  return staffRoute(req, { method: 'POST', schema: profileBody }, async (ctx, b) => {
    const id = idParam.safeParse(user);
    if (!id.success) throw new ApiError(404, 'not_found');
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_staff_profile_set', { p_user: id.data, p_department: b.department, p_whatsapp: b.whatsapp ?? null, p_is_head: b.is_head }), ctx.requestId);
  });
}
