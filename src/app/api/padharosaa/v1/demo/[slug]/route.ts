import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { encryptText, newSessionToken, toBytea, tokenHash, mobileHash } from '@/lib/padharosaa/crypto';
import { setPadCookie } from '@/lib/padharosaa/guest';
import { slug } from '@/lib/padharosaa/schemas';
import { randomInt } from 'node:crypto';

export const dynamic = 'force-dynamic';

// A public demo hotel (switched on by the platform admin): the visitor gets a fresh guest session with no sign-in. Any other hotel answers 404.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: s } = await params;
  return guestRoute(req, { method: 'POST' }, async (ctx) => {
    const parsed = slug.safeParse(s);
    if (!parsed.success) throw new ApiError(404, 'not_found');
    const guessKey = `padh_demo_try:${ctx.ipHash}`;
    await guard(guessKey, 40, 600);
    const info = await rpc<{ name: string; slug: string } | null>('padh_demo_info', { p_slug: parsed.data });
    if (!info) { await penalize(guessKey, 600); throw new ApiError(404, 'not_found'); }
    const token = newSessionToken();
    const digits = String(randomInt(1_000_000_000, 9_999_999_999)); // a made-up number: nobody is ever contacted
    const out = await rpc<{ session_id: string; slug: string; room: string }>('padh_demo_enter', {
      p_slug: parsed.data,
      p_token_hash: toBytea(tokenHash(token)),
      p_mobile_enc: toBytea(encryptText(`+91${digits}`)),
      p_mobile_hash: toBytea(mobileHash('+91', digits)),
      p_ip_hash: ctx.ipHash,
    });
    const res = jsonOk({ ok: true, next: `/padharosaa/${out.slug}`, room: out.room }, ctx.requestId);
    setPadCookie(res, token);
    return res;
  });
}
