import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { qrKey, slug } from '@/lib/padharosaa/schemas';

export const dynamic = 'force-dynamic';

// Login page data for a hotel. The QR key is the only thing that opens it; every failure looks identical (no hotel enumeration).
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: s } = await params;
  return guestRoute(req, { method: 'GET' }, async (ctx) => {
    const k = new URL(req.url).searchParams.get('k');
    const parsedSlug = slug.safeParse(s);
    const parsedKey = qrKey.safeParse(k);
    const guessKey = `padh_pub:${ctx.ipHash}`;
    await guard(guessKey, 30, 600);
    if (!parsedSlug.success || !parsedKey.success) {
      await penalize(guessKey, 600);
      throw new ApiError(403, 'invalid_table_token');
    }
    const hotel = await rpc<Record<string, unknown>>('padh_public_hotel', { p_slug: parsedSlug.data, p_k: parsedKey.data }).catch(async (e: unknown) => {
      if (e instanceof ApiError && e.key === 'invalid_table_token') await penalize(guessKey, 600);
      throw e;
    });
    return jsonOk(hotel, ctx.requestId);
  });
}
