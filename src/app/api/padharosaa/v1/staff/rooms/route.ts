import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { roomsBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// The hotel's rooms. Listing is for desk staff too; adding is owner/manager only (checked in SQL).
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk({ rooms: await staffRpc(ctx.db, 'padh_rooms_list') }, ctx.requestId);
  });
}

export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: roomsBody }, async (ctx, b) => {
    await limit(`prm:${ctx.userId}`, 30, 3600);
    return jsonOk(await staffRpc(ctx.db, 'padh_rooms_add', { p_numbers: b.numbers }), ctx.requestId);
  });
}
