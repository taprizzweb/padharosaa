import { jsonOk, staffRoute } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { temporaryPassword } from '@/lib/dash/temp-password';
import { limit, rpc } from '@/lib/guest/rpc';
import { staffImportBody } from '@/lib/padharosaa/schemas';
import { adminClient } from '@/lib/supabase/admin';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

const ROLE_FOR_DEPARTMENT = { kitchen: 'kitchen', manager: 'manager' } as const;

interface Result { email: string; ok: boolean; error?: 'exists' | 'failed'; temporary_password?: string }

// Owner only: add up to 200 people at once (a CSV the browser has already parsed). Each person gets their own login with a random
// temporary password that must be changed at first sign-in. The passwords come back ONCE in this response (for handing out) and are
// never stored or readable again; "reset password" in the staff screen makes a new one.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: staffImportBody }, async (ctx, b) => {
    const me = await staffRpc<{ role: string; restaurant: { status: string } } | null>(ctx.db, 'staff_me');
    if (!me || me.role !== 'owner') throw new ApiError(403, 'forbidden');
    if (me.restaurant.status !== 'active') throw new ApiError(403, 'restaurant_suspended');
    await limit(`psi:${ctx.userId}`, 5, 600); // 5 imports per 10 minutes
    const admin = adminClient();
    const results: Result[] = [];
    for (const row of b.rows) {
      const password = temporaryPassword();
      const { data, error } = await admin.auth.admin.createUser({ email: row.email, password, email_confirm: true, app_metadata: { must_change_password: true } });
      if (error || !data.user) { results.push({ email: row.email, ok: false, error: error && /already|exists|registered/i.test(error.message) ? 'exists' : 'failed' }); continue; }
      try {
        const role = ROLE_FOR_DEPARTMENT[row.department as keyof typeof ROLE_FOR_DEPARTMENT] ?? 'waiter';
        await rpc('owner_add_staff', { p_owner: ctx.userId, p_user: data.user.id, p_role: role, p_name: row.name });
        await staffRpc(ctx.db, 'padh_staff_profile_set', { p_user: data.user.id, p_department: row.department, p_whatsapp: row.whatsapp ?? null, p_is_head: row.is_head });
        results.push({ email: row.email, ok: true, temporary_password: password });
      } catch {
        await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined); // never leave a login with no hotel behind
        results.push({ email: row.email, ok: false, error: 'failed' });
      }
    }
    return jsonOk({ results }, ctx.requestId, { status: 201 });
  });
}
