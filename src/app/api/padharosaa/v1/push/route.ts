import { z } from 'zod';
import { jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { vapid } from '@/lib/padharosaa/push';

export const dynamic = 'force-dynamic';

const subBody = z.object({
  subscription: z.object({ endpoint: z.string().url().max(1000), expirationTime: z.number().nullish(), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).nullable(),
});

// Is phone alerting available on this server (keys set)? The public key is not a secret.
export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 240, 60);
    return jsonOk({ key: vapid()?.publicKey ?? null }, ctx.requestId);
  });
}
// The guest allows (or switches off) buffet alerts on this phone.
export async function POST(req: Request) {
  return padGuestRoute(req, { method: 'POST', schema: subBody }, async (ctx, b) => {
    await limit(`padg:${ctx.me.session_id}`, 30, 60);
    await rpc('padh_guest_set_push', { p_session: ctx.me.session_id, p_sub: b.subscription });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
