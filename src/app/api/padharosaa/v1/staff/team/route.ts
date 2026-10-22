import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: everyone on the team with department, WhatsApp number and head flag. Passwords are never stored or shown here.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk({ staff: await staffRpc(ctx.db, 'padh_staff_directory') }, ctx.requestId);
  });
}
