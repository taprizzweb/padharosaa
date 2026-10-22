import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { passwordChange } from '@/lib/schemas/dash';
import { adminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// "Choose your own password": the only action a user with a temporary password may take.
// Supabase's own rules apply as well (minimum length, and a check against passwords leaked in known breaches).
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: passwordChange, allowTempPassword: true }, async (ctx, body) => {
    const { error } = await ctx.db.auth.updateUser({ password: body.password });
    if (error) throw new ApiError(400, 'invalid_input');
    // app_metadata can only be written by the server, so the user cannot clear the flag without really changing the password
    const { error: e2 } = await adminClient().auth.admin.updateUserById(ctx.userId, { app_metadata: { must_change_password: false } });
    if (e2) throw Object.assign(new Error('could not clear password flag'), { dbCode: String(e2.status ?? '') });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
