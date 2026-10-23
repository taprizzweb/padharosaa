import { jsonOk, staffRoute } from '@/lib/api/route';
import { serverEnv } from '@/env';
import { limit } from '@/lib/guest/rpc';
import { staffRpc } from '@/lib/staff/rpc';

export const dynamic = 'force-dynamic';

// Owner / manager: the current values behind the manager screen.
export async function GET(req: Request) {
  return staffRoute(req, { method: 'GET' }, async (ctx) => {
    await limit(`ps:${ctx.userId}`, 120, 60);
    const settings = await staffRpc<Record<string, unknown>>(ctx.db, 'padh_manage_settings');
    // never the key itself: only whether guests can sign in (their mobile numbers are encrypted with it)
    return jsonOk({ ...settings, server_ready: !!serverEnv().PADHAROSAA_DATA_KEY }, ctx.requestId);
  });
}
