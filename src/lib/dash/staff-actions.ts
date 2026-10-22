/* eslint-disable @typescript-eslint/no-explicit-any -- each action's input type is fixed by its own zod schema; the table maps names to them */
import 'server-only';
import type { ZodType } from 'zod';
import { ApiError } from '@/lib/errors';
import { jsonOk, type StaffCtx } from '@/lib/api/route';
import { temporaryPassword } from '@/lib/dash/temp-password';
import { rpc } from '@/lib/guest/rpc';
import { staffAdd, staffReset, staffUpdate } from '@/lib/schemas/dash';
import { staffRpc } from '@/lib/staff/rpc';
import { adminClient } from '@/lib/supabase/admin';

/**
 * Staff accounts need Supabase Auth (creating a login, resetting a password), which only the service key may do.
 * The signed-in owner is verified TWICE: here (staff_me) and again inside the SQL function, which is told who is asking.
 * Nothing sensitive is logged; a temporary password is returned once and never stored by us.
 */
export const STAFF_ACTIONS: Record<string, { method: 'POST'; schema: ZodType<any> }> = {
  'staff-add': { method: 'POST', schema: staffAdd },
  'staff-update': { method: 'POST', schema: staffUpdate },
  'staff-reset-password': { method: 'POST', schema: staffReset },
};

async function requireOwner(ctx: StaffCtx): Promise<void> {
  const me = await staffRpc<{ role: string; restaurant: { status: string } } | null>(ctx.db, 'staff_me');
  if (!me || me.role !== 'owner') throw new ApiError(403, 'forbidden');
  if (me.restaurant.status !== 'active') throw new ApiError(403, 'restaurant_suspended');
}

export async function handleStaffAction(action: string, ctx: StaffCtx, body: any): Promise<Response> {
  await requireOwner(ctx);
  const admin = adminClient();

  if (action === 'staff-add') {
    const password = temporaryPassword();
    const { data, error } = await admin.auth.admin.createUser({ email: body.email, password, email_confirm: true, app_metadata: { must_change_password: true } });
    if (error || !data.user) {
      // "already registered" is the only error a user can fix; everything else is ours
      if (error && /already|exists|registered/i.test(error.message)) throw new ApiError(409, 'conflict');
      throw Object.assign(new Error('could not create auth user'), { dbCode: String(error?.status ?? '') });
    }
    try {
      await rpc('owner_add_staff', { p_owner: ctx.userId, p_user: data.user.id, p_role: body.role, p_name: body.name });
    } catch (e) {
      await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined); // do not leave a login with no restaurant behind
      throw e;
    }
    return jsonOk({ user_id: data.user.id, email: body.email, temporary_password: password }, ctx.requestId, { status: 201 });
  }

  if (action === 'staff-update') {
    await rpc('owner_set_staff', { p_owner: ctx.userId, p_user: body.user_id, p_role: body.role, p_name: body.name, p_active: body.active });
    return jsonOk({ ok: true }, ctx.requestId);
  }

  // staff-reset-password
  await rpc('owner_check_staff', { p_owner: ctx.userId, p_user: body.user_id });
  const password = temporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(body.user_id, { password, app_metadata: { must_change_password: true } });
  if (error) throw Object.assign(new Error('could not reset password'), { dbCode: String(error.status ?? '') });
  return jsonOk({ temporary_password: password }, ctx.requestId);
}
