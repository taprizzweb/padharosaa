import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { brandingBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Manager / owner: colour, logo, photo (with crop) and links. Text and button colours are derived from the colour in the app, not stored.
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: brandingBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    await staffRpc(ctx.db, 'padh_set_branding', {
      p_brand_color: b.brand_color ?? null, p_logo_path: b.logo_path ?? null, p_logo_crop: b.logo_crop ?? null, p_hero_path: b.hero_path ?? null, p_hero_crop: b.hero_crop ?? null,
      p_instagram: b.instagram ?? null, p_google: b.google_review_url ?? null, p_tripadvisor: b.tripadvisor_url ?? null, p_menu: b.menu_url ?? null,
    });
    return jsonOk({ ok: true }, ctx.requestId);
  });
}
