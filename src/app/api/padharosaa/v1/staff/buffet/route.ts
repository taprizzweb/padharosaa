import { jsonOk, staffRoute } from '@/lib/api/route';
import { limit } from '@/lib/guest/rpc';
import { buffetBody } from '@/lib/padharosaa/schemas';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager / reception: the buffet for today and the next seven days.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_buffet_list'), ctx.requestId);
  });
}
export async function POST(req: Request) {
  return staffRoute(req, { method: 'POST', schema: buffetBody }, async (ctx, b) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    return jsonOk(await staffRpc(ctx.db, 'padh_buffet_set', { p_date: b.date, p_mode: b.mode, p_name: b.name ?? null, p_start: b.start ?? null, p_end: b.end ?? null, p_venue: b.venue ?? null, p_highlights: b.highlights ?? null, p_mood: b.mood ?? null }), ctx.requestId);
  });
}
