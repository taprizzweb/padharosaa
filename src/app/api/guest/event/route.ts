import { guestRoute, jsonOk } from '@/lib/api/route';
import { rpc } from '@/lib/guest/rpc';
import { eventBody } from '@/lib/schemas/guest';

export const dynamic = 'force-dynamic';

// Menu analytics beacon. Always answers ok: a dropped, duplicate or rate-limited event is not an error the guest should ever see.
export async function POST(req: Request) {
  return guestRoute(req, { method: 'POST', schema: eventBody }, async (ctx, b) => {
    await rpc('guest_record_event', {
      p_slug: b.slug, p_token: b.token ?? null, p_visit: b.visit, p_event: b.event,
      p_item: b.item_id ?? null, p_category: b.category_id ?? null, p_ip_hash: ctx.ipHash,
    });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
