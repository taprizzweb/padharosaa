import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { helpDoneBody } from '@/lib/schemas/staff';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// A guest problem (towel, WiFi...) is dealt with: it leaves the reception screen.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: helpDoneBody }, async (ctx, b) => {
    await limit(`sm:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'staff_resolve_help', { p_help_id: b.help_id }), ctx.requestId);
  });
}
