import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Taxes, charges, room types, invoice details: everything the hotel has set up for billing. Reception, manager and owner read it.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`psb:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_billing_get'), ctx.requestId);
  });
}
