import { guestRoute, jsonOk } from '@/lib/api/route';
import { serverEnv } from '@/env';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { loginBody, safeNext } from '@/lib/schemas/staff';
import { areaHref, homeFor, isPadHost } from '@/lib/padharosaa/areas';
import { hashIp } from '@/lib/security/ip';
import { staffRpc } from '@/lib/staff/rpc';
import { userClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Email + password sign-in for staff. Every failure looks the same (no hint whether the account exists),
// and attempts are limited per address and per account.
export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: loginBody }, async (ctx, body) => {
    // Only FAILED attempts count: 20 per address and 8 per account in the window (a restaurant's staff share one wifi address).
    const ipKey = `lg:${ctx.ipHash}`;
    const emailKey = `le:${hashIp(body.email, serverEnv().IP_HASH_SALT)}`;
    await guard(ipKey, 20, 600);
    await guard(emailKey, 8, 900);
    const fail = async (status: number, key: 'invalid_credentials' | 'rate_limited'): Promise<never> => {
      if (key === 'invalid_credentials') await Promise.all([penalize(ipKey, 600), penalize(emailKey, 900)]);
      throw new ApiError(status, key);
    };

    const db = await userClient();
    const { error } = await db.auth.signInWithPassword({ email: body.email, password: body.password });
    if (error) return fail(error.status === 429 ? 429 : 401, error.status === 429 ? 'rate_limited' : 'invalid_credentials');

    // A valid login that is not (or no longer) an active staff member gets the same generic answer.
    const me = await staffRpc<unknown>(db, 'staff_me').catch(() => null);
    const { data: who } = await db.auth.getUser();
    // a platform admin always lands on the admin panel, even while visiting a hotel's menu as its manager (migration 0051)
    const isAdmin = !!who.user && (await rpc<boolean>('admin_check', { p_user: who.user.id }).catch(() => false));
    if (!me && !isAdmin) {
      await db.auth.signOut();
      return fail(401, 'invalid_credentials');
    }
    // A Padharosaa hotel's staff land on their own page (owner, manager, kitchen, reception or housekeeping); everyone else keeps the menu live screen.
    const onPadHost = isPadHost(req.headers.get('x-forwarded-host') ?? req.headers.get('host'));
    let home = isAdmin ? '/admin' : '/staff';
    if (me && !isAdmin && !body.next) {
      // padh_my_alerts only answers for staff of an enabled Padharosaa hotel, so a good answer also means "this is a hotel".
      const alerts = await staffRpc<{ teams?: string[] | null }>(db, 'padh_my_alerts').catch(() => null);
      if (alerts || onPadHost) {
        const area = homeFor((me as { role?: string }).role ?? '') ?? 'desk';
        home = areaHref(area, onPadHost);
      }
    }
    return jsonOk({ ok: true, next: body.next ? safeNext(body.next) : home }, ctx.requestId);
  });
}
