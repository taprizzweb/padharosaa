import { jsonOk, staffRoute } from '@/lib/api/route';
import { serverEnv } from '@/env';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: the whole Jaipur guide, drafts included, plus whether AI wording is switched on.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    const env = serverEnv();
    const g = await staffRpc<Record<string, unknown>>(ctx.db, 'padh_guide_manage');
    return jsonOk({ ...g, ai_available: !!(env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL) }, ctx.requestId);
  });
}
