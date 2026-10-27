import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { lguideBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: the guides the hotel recommends (people), including the ones switched off.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`plg:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_lguide_manage'), ctx.requestId);
  });
}
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: lguideBody }, async (ctx, b) => {
    await limit(`plg:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_lguide_save', {
      p_id: b.id ?? null, p_name: b.name, p_title: b.title ?? null, p_about: b.about ?? null, p_languages: b.languages ?? null, p_charges: b.charges ?? null,
      p_phone: b.phone ?? null, p_whatsapp: b.whatsapp ?? null, p_instagram: b.instagram ?? null, p_linkedin: b.linkedin ?? null, p_active: b.active, p_sort: b.sort,
    }), ctx.requestId);
  });
}
