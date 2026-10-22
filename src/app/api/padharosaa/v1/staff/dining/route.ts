import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { diningBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Manager / owner: does this hotel serve food to the room? When off, "room delivery" is never offered and the database refuses it.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: diningBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_set_dining', { p_room_dining: b.room_dining }), ctx.requestId);
  });
}
