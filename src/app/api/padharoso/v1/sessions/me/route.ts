import { jsonOk } from '@/lib/api/route';
import { padGuestRoute } from '@/lib/padharoso/guest';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    const m = ctx.me;
    return jsonOk(
      { session_id: m.session_id, room: m.room, name: m.name, language: m.language, diet: m.diet, occasion: m.occasion, hotel_name: m.hotel_name, slug: m.slug, theme: m.theme, verification_level: m.verification_level, timezone: m.timezone },
      ctx.requestId,
    );
  });
}
