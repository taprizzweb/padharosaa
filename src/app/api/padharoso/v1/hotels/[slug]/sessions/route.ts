import { guestRoute, jsonOk } from '@/lib/api/route';
import { ApiError } from '@/lib/errors';
import { guard, penalize, rpc } from '@/lib/guest/rpc';
import { encryptText, mobileHash, newSessionToken, TOKEN_RE, tokenHash, toBytea } from '@/lib/padharoso/crypto';
import { readPadToken, setPadCookie } from '@/lib/padharoso/guest';
import { loginBody, slug } from '@/lib/padharoso/schemas';

export const dynamic = 'force-dynamic';

interface LoginResult {
  ok: boolean;
  code?: 'unknown_room' | 'login_failed' | 'locked';
  resumed?: boolean;
  language?: string;
}

// Guest login. Name and room are checked here and again in SQL; the mobile number is encrypted and keyed-hashed BEFORE it reaches the
// database, and the session token is generated here (the database stores only its SHA-256).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: s } = await params;
  return guestRoute(req, { method: 'POST', schema: loginBody }, async (ctx, b) => {
    const parsedSlug = slug.safeParse(s);
    if (!parsedSlug.success) throw new ApiError(403, 'invalid_table_token');
    const guessKey = `padh_key:${ctx.ipHash}`;
    await guard(guessKey, 20, 600);

    const digits = b.mobile.replace(/[\s-]/g, '');
    const token = newSessionToken();
    const cookie = readPadToken(req.headers);
    const out = await rpc<LoginResult>('padh_guest_login', {
      p_slug: parsedSlug.data,
      p_k: b.k,
      p_name: b.name,
      p_cc: b.cc,
      p_mobile_enc: toBytea(encryptText(`${b.cc}${digits}`)),
      p_mobile_hash: toBytea(mobileHash(b.cc, digits)),
      p_language: b.language,
      p_room: b.room,
      p_stay_code: b.stay_code ?? null,
      p_token_hash: toBytea(tokenHash(token)),
      p_resume_token_hash: cookie && TOKEN_RE.test(cookie) ? toBytea(tokenHash(cookie)) : null,
      p_consent: b.consent,
      p_consent_version: b.consent ? (b.consent_version ?? null) : null,
      p_ip_hash: ctx.ipHash,
    }).catch(async (e: unknown) => {
      if (e instanceof ApiError && e.key === 'invalid_table_token') await penalize(guessKey, 600);
      throw e;
    });

    if (!out.ok) {
      if (out.code === 'locked') throw new ApiError(429, 'locked');
      if (out.code === 'unknown_room') throw new ApiError(422, 'unknown_room');
      throw new ApiError(422, 'login_failed');
    }
    const res = jsonOk({ ok: true, resumed: out.resumed === true, language: out.language }, ctx.requestId);
    if (!out.resumed) setPadCookie(res, token); // a resumed session keeps the cookie it already has
    return res;
  });
}
