import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { vapid } from '@/lib/padharosaa/push';
import { staffPushBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// The public key a browser needs to subscribe (null when the server has no push keys).
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`psp:${ctx.userId}`, 60, 60);
    return jsonOk({ key: vapid()?.publicKey ?? null }, ctx.requestId);
  });
}

// This device on (a browser subscription) or off (null + its endpoint). Any signed-in staff member, for their own devices.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: staffPushBody }, async (ctx, b) => {
    await limit(`psp:${ctx.userId}`, 60, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_staff_push_set', { p_sub: b.subscription ? JSON.stringify(b.subscription) : null, p_endpoint: b.endpoint ?? b.subscription?.endpoint ?? null }), ctx.requestId);
  });
}
