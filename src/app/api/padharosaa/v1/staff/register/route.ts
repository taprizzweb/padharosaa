import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { limit } from '@/lib/guest/rpc';
import { reportQuery } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// The guest register for the front desk: for each day, who was in the hotel, who came and went, and what each guest asked for (at most 31 days).
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    const sp = new URL(req.url).searchParams;
    const q = reportQuery.safeParse({ from: sp.get('from'), to: sp.get('to') });
    if (!q.success) throw new ApiError(400, 'invalid_input');
    await limit(`prg:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_guest_register', { p_from: q.data.from, p_to: q.data.to }), ctx.requestId);
  });
}
