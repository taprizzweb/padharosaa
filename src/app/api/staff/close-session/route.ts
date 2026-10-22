import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { closeSessionBody } from '@/lib/schemas/staff';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// "Mark as paid". Blocked while orders are unserved unless an owner/manager forces it with a reason (checked in SQL).
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: closeSessionBody }, async (ctx, b) => {
    await limit(`sm:${ctx.userId}`, 120, 60);
    const r = await staffRpc(ctx.db, 'staff_close_session', {
      p_session_id: b.session_id,
      p_force: b.force ?? false,
      p_reason: b.reason ?? null,
      p_pay_mode: b.pay_mode ?? null,
    });
    return jsonOk(r, ctx.requestId);
  });
}
