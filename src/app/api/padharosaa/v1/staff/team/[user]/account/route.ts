import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { temporaryPassword } from '@/lib/dash/temp-password';
import { limit, rpc } from '@/lib/guest/rpc';
import { accountBody, idParam } from '@/lib/padharosaa/schemas';
import { adminClient } from '@/lib/supabase/admin';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner only: give a team member a new one-time password (they must change it at their next sign-in), or correct their email.
// The password is shown once in this response and never stored. The owner's own login cannot be changed here.
export async function POST(req: Request, { params }: { params: Promise<{ user: string }> }) {
  const { user } = await params;
  return staffRoute(req, { method: 'POST', schema: accountBody }, async (ctx, b) => {
    const id = idParam.safeParse(user);
    if (!id.success) throw new ApiError(404, 'not_found');
    const me = await staffRpc<{ role: string; restaurant: { status: string } } | null>(ctx.db, 'staff_me');
    if (!me || me.role !== 'owner') throw new ApiError(403, 'forbidden');
    if (me.restaurant.status !== 'active') throw new ApiError(403, 'restaurant_suspended');
    await limit(`pta:${ctx.userId}`, 20, 600);
    const admin = adminClient();
    if (b.action === 'reset') {
      await rpc('owner_check_staff_action', { p_owner: ctx.userId, p_user: id.data, p_action: 'staff_password_reset' });
      const password = temporaryPassword();
      const { error } = await admin.auth.admin.updateUserById(id.data, { password, app_metadata: { must_change_password: true } });
      if (error) throw Object.assign(new Error('could not reset password'), { dbCode: String(error.status ?? '') });
      return jsonOk({ temporary_password: password }, ctx.requestId);
    }
    await rpc('owner_check_staff_action', { p_owner: ctx.userId, p_user: id.data, p_action: 'staff_email_changed' });
    const { error } = await admin.auth.admin.updateUserById(id.data, { email: b.email, email_confirm: true });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) throw new ApiError(409, 'conflict');
      throw Object.assign(new Error('could not change email'), { dbCode: String(error.status ?? '') });
    }
    return jsonOk({ ok: true, email: b.email }, ctx.requestId);
  });
}
