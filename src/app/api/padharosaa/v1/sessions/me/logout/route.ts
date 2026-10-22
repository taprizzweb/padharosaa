import { jsonOk } from '@/lib/api/route';
import { rpc } from '@/lib/guest/rpc';
import { clearPadCookie, padGuestRoute } from '@/lib/padharosaa/guest';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return padGuestRoute(req, { method: 'POST' }, async (ctx) => {
    await rpc('padh_guest_logout', { p_session: ctx.me.session_id });
    const res = jsonOk({ ok: true }, ctx.requestId);
    clearPadCookie(res as import('next/server').NextResponse);
    return res;
  });
}
