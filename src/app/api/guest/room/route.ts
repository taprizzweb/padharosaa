import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { roomBody } from '@/lib/schemas/guest';

export const dynamic = 'force-dynamic';

// The shared room-service link plus a room number opens that room's own table link. Placing an order still goes through
// the normal order route (with the room's token), so every ordering rule and limit applies unchanged.
export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: roomBody }, async (ctx, body) => {
    const guessKey = `tok:${ctx.ipHash}`;
    await guard(guessKey, 20, 600);
    const r = await rpc<{ token: string; label: string }>('guest_open_room', {
      p_slug: body.slug,
      p_token: body.token,
      p_room: body.room,
      p_ip_hash: ctx.ipHash,
    }).catch(async (e: unknown) => {
      if (e instanceof ApiError && e.key === 'invalid_table_token') await penalize(guessKey, 600);
      throw e;
    });
    return jsonOk({ token: r.token, label: r.label }, ctx.requestId);
  });
}
