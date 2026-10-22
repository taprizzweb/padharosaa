import { jsonOk } from '@/lib/api/route';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';
import { preferencesBody } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return padGuestRoute(req, { method: 'POST', schema: preferencesBody }, async (ctx, b) => {
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    await rpc('padh_guest_set_preferences', { p_session: ctx.me.session_id, p_diet: b.diet, p_occasion: b.occasion, p_language: b.language ?? null });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
