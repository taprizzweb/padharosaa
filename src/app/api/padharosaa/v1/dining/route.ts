import { jsonOk } from '@/lib/api/route';
import { publicEnv } from '@/env';
import { limit, rpc } from '@/lib/guest/rpc';
import { padGuestRoute } from '@/lib/padharosaa/guest';

export const dynamic = 'force-dynamic';

interface Dining { room: string; room_dining: boolean; menu_url: string | null; own_slug: string; own_room_token: string | null; hotel_slug: string }
interface Menu { status: string; categories?: { id: string; name_en: string; items: { is_available: boolean }[] }[] }

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Dining for the guest: the menu address with the guest's room already filled in and a "back to hotel" link, plus the category chips
 * of that menu (so the guest can pick what they feel like first). The menu is either the link the manager pasted (a cafe on its own
 * address) or this hotel's own restaurant on its room-service link.
 */
export async function GET(req: Request) {
  return padGuestRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`padg:${ctx.me.session_id}`, 120, 60);
    const d = await rpc<Dining>('padh_guest_dining', { p_session: ctx.me.session_id });
    const origin = publicEnv().NEXT_PUBLIC_APP_ORIGIN;
    let base: URL | null = null;
    let slug: string | null = null;
    if (d.menu_url) {
      try {
        const u = new URL(d.menu_url);
        const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
        if (u.protocol === 'https:' && SLUG.test(first)) { base = u; slug = first; }
      } catch { /* an unusable link: fall back to the hotel's own menu */ }
    }
    if (!base && d.own_room_token) { base = new URL(`${origin}/${d.own_slug}?k=${d.own_room_token}`); slug = d.own_slug; }
    if (!base || !slug) return jsonOk({ available: false, room_dining: d.room_dining }, ctx.requestId);
    base.searchParams.set('room', d.room);
    base.searchParams.set('back', `${origin}/padharosaa/${d.hotel_slug}`);
    let chips: { id: string; name: string }[] = [];
    try {
      const m = await rpc<Menu>('guest_get_menu', { p_slug: slug, p_token: null });
      chips = (m.categories ?? []).filter((c) => c.items.some((i) => i.is_available)).map((c) => ({ id: c.id, name: c.name_en }));
    } catch { /* chips are a convenience: the full menu still opens */ }
    return jsonOk({ available: true, room_dining: d.room_dining, base: base.toString(), chips }, ctx.requestId);
  });
}
