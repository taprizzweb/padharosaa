import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { helpBody } from '@/lib/schemas/guest';

export const dynamic = 'force-dynamic';

// "Call for problems": the shared help link, a room number, the topics that apply and an optional note go to reception's live screen.
export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: helpBody }, async (ctx, body) => {
    const guessKey = `tok:${ctx.ipHash}`;
    await guard(guessKey, 20, 600);
    const r = await rpc<{ id: string; room: string; replayed: boolean }>('guest_create_help', {
      p_slug: body.slug,
      p_token: body.token,
      p_room: body.room,
      p_topics: body.topics,
      p_note: body.note || null,
      p_ip_hash: ctx.ipHash,
    }).catch(async (e: unknown) => {
      if (e instanceof ApiError && e.key === 'invalid_table_token') await penalize(guessKey, 600);
      throw e;
    });
    return jsonOk({ room: r.room, replayed: r.replayed }, ctx.requestId);
  });
}
