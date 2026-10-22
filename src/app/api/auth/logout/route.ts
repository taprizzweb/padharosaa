import { guestRoute, jsonOk } from '@/lib/api/route';
import { logoutBody } from '@/lib/schemas/staff';
import { userClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// scope "local" ends this device's session; "global" ends the account's sessions on every device.
export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: logoutBody }, async (ctx, body) => {
    const db = await userClient();
    await db.auth.signOut({ scope: body.scope });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
