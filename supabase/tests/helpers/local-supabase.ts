/**
 * LOCAL STAND-IN for the parts of Supabase the app talks to over HTTP (never used in production):
 *   POST /auth/v1/token?grant_type=password|refresh_token   email + password login, signed JWT access tokens
 *   GET  /auth/v1/user                                      who does this token belong to
 *   POST /auth/v1/logout
 *   POST /rest/v1/rpc/<function>                            SQL functions, run as the role the token proves
 * Role mapping mirrors Supabase: service key => service_role, a valid user JWT => authenticated, else anon.
 * Realtime is not emulated (the app falls back to polling, which is also what runs if Realtime is down).
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { Pool } from 'pg';
import { callRpc } from './rpc';
import { newSecret, totpValid } from './totp';

const MAX_UPLOAD_BYTES = 2_097_152;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const WEAK = /^(password|12345678|qwerty|letmein)/i;

export const LOCAL_JWT_SECRET = 'local-jwt-secret-local-jwt-secret-1234567890';
export const LOCAL_SERVICE_KEY = 'local-service-role-key-local-service-role';
export const LOCAL_ANON_KEY = 'local-anon-key-local-anon-key-local';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPass#2025!';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function signJwt(claims: Record<string, unknown>): string {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  return `${body}.${createHmac('sha256', LOCAL_JWT_SECRET).update(body).digest('base64url')}`;
}

export function verifyJwt(token: string): Record<string, any> | null {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const expected = createHmac('sha256', LOCAL_JWT_SECRET).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, any>;
  return typeof claims.exp === 'number' && claims.exp > Date.now() / 1000 ? claims : null;
}

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
async function readBody(req: IncomingMessage): Promise<any> {
  const text = (await readRaw(req)).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** The file part of a multipart/form-data upload (what supabase-js sends for Blobs). */
function multipartFile(body: Buffer, contentType: string): { data: Buffer; type: string } | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return null;
  const sep = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let pos = body.indexOf(sep);
  let found: { data: Buffer; type: string } | null = null;
  while (pos !== -1) {
    const next = body.indexOf(sep, pos + sep.length);
    if (next === -1) break;
    const part = body.subarray(pos + sep.length + 2, next - 2); // strip CRLF around the part
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const head = part.subarray(0, split).toString('utf8');
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
      if (type) found = { data: part.subarray(split + 4), type };
    }
    pos = next;
  }
  return found;
}

export function startLocalSupabase(pool: Pool, port: number, opts: { ttlSeconds?: number } = {}): Promise<Server> {
  const ttl = opts.ttlSeconds ?? 3600;
  const refreshTokens = new Map<string, { id: string; aal: 'aal1' | 'aal2' }>(); // refresh token -> user id and assurance level
  const challenges = new Map<string, string>(); // challenge id -> factor id

  const userJson = async (id: string, email: string, app_metadata: object = {}) => ({
    id, aud: 'authenticated', role: 'authenticated', email, app_metadata, user_metadata: {}, created_at: new Date().toISOString(),
    factors: (await pool.query(`select id, friendly_name, factor_type, status from auth.mfa_factors where user_id = $1 order by created_at`, [id])).rows,
  });
  const files = new Map<string, { data: Buffer; type: string }>();
  const session = async (id: string, email: string, app_metadata: object = {}, aal: 'aal1' | 'aal2' = 'aal1') => {
    const now = Math.floor(Date.now() / 1000);
    const refresh = randomUUID();
    refreshTokens.set(refresh, { id, aal });
    return {
      access_token: signJwt({ sub: id, email, role: 'authenticated', aud: 'authenticated', aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now }], app_metadata, iat: now, exp: now + ttl }),
      token_type: 'bearer', expires_in: ttl, expires_at: now + ttl, refresh_token: refresh, user: await userJson(id, email, app_metadata),
    };
  };

  const send = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      ...(origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'origin' } : {}),
    });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': origin ?? '*', 'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info, x-supabase-api-version, prefer, x-upsert, cache-control',
          'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-max-age': '600',
        });
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];

      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const body = await readBody(req);
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const { rows } = await pool.query<{ id: string; email: string; password: string | null; app_metadata: object }>(`select id, email, password, app_metadata from auth.users where email = $1`, [String(body.email ?? '').toLowerCase()]);
          const u = rows[0];
          // seeded demo users have no stored password and use the shared demo password
          if (!u || body.password !== (u.password ?? DEMO_PASSWORD)) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, origin);
          return send(res, 200, await session(u.id, u.email, u.app_metadata), origin);
        }
        if (grant === 'refresh_token') {
          const prev = refreshTokens.get(String(body.refresh_token));
          if (!prev) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, origin);
          refreshTokens.delete(String(body.refresh_token));
          const { rows } = await pool.query<{ email: string; app_metadata: object }>(`select email, app_metadata from auth.users where id = $1`, [prev.id]);
          return send(res, 200, await session(prev.id, rows[0]!.email, rows[0]!.app_metadata, prev.aal), origin);
        }
        return send(res, 400, { msg: 'unsupported grant' }, origin);
      }
      if (url.pathname === '/auth/v1/user' && (req.method === 'GET' || req.method === 'PUT')) {
        const claims = bearer ? verifyJwt(bearer) : null;
        if (!claims || claims.role !== 'authenticated') return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, origin);
        const { rows } = await pool.query<{ email: string; app_metadata: object }>(`select email, app_metadata from auth.users where id = $1`, [claims.sub]);
        if (!rows[0]) return send(res, 401, { code: 401, error_code: 'user_not_found', msg: 'User not found' }, origin);
        if (req.method === 'PUT') {
          const body = await readBody(req);
          if (typeof body.password === 'string') {
            if (body.password.length < 12) return send(res, 422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 12 characters.' }, origin);
            if (WEAK.test(body.password)) return send(res, 422, { code: 422, error_code: 'weak_password', msg: 'Password is known to be weak and easy to guess' }, origin);
            await pool.query(`update auth.users set password = $2 where id = $1`, [claims.sub, body.password]);
          }
        }
        return send(res, 200, await userJson(claims.sub, rows[0].email, rows[0].app_metadata), origin);
      }
      // ---- second factor (TOTP), same shapes as Supabase Auth
      const mfa = /^\/auth\/v1\/factors(?:\/([0-9a-f-]{36})(?:\/(challenge|verify))?)?$/.exec(url.pathname);
      if (mfa) {
        const claims = bearer ? verifyJwt(bearer) : null;
        if (!claims || claims.role !== 'authenticated') return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, origin);
        const [, fid, op] = mfa;
        if (!fid && req.method === 'POST') {
          const b = await readBody(req);
          const secret = newSecret();
          const r = await pool.query<{ id: string }>(`insert into auth.mfa_factors (user_id, friendly_name, secret) values ($1,$2,$3) returning id`, [claims.sub, String(b.friendly_name ?? 'phone'), secret]);
          const { rows } = await pool.query<{ email: string }>(`select email from auth.users where id = $1`, [claims.sub]);
          const uri = `otpauth://totp/${encodeURIComponent(String(b.issuer ?? 'GoToMenu'))}:${encodeURIComponent(rows[0]!.email)}?secret=${secret}&issuer=${encodeURIComponent(String(b.issuer ?? 'GoToMenu'))}`;
          const qr = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')}`;
          return send(res, 200, { id: r.rows[0]!.id, type: 'totp', friendly_name: b.friendly_name, totp: { qr_code: qr, secret, uri } }, origin);
        }
        if (fid && !op && req.method === 'DELETE') {
          if (claims.aal !== 'aal2') {
            const v = await pool.query(`select 1 from auth.mfa_factors where id = $1 and user_id = $2 and status = 'verified'`, [fid, claims.sub]);
            if (v.rowCount) return send(res, 422, { code: 422, error_code: 'insufficient_aal', msg: 'AAL2 required to unenroll a verified factor' }, origin);
          }
          await pool.query(`delete from auth.mfa_factors where id = $1 and user_id = $2`, [fid, claims.sub]);
          return send(res, 200, { id: fid }, origin);
        }
        if (fid && op === 'challenge' && req.method === 'POST') {
          const own = await pool.query(`select 1 from auth.mfa_factors where id = $1 and user_id = $2`, [fid, claims.sub]);
          if (!own.rowCount) return send(res, 404, { code: 404, error_code: 'mfa_factor_not_found', msg: 'MFA factor not found' }, origin);
          const cid = randomUUID();
          challenges.set(cid, fid);
          return send(res, 200, { id: cid, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 }, origin);
        }
        if (fid && op === 'verify' && req.method === 'POST') {
          const b = await readBody(req);
          const f = await pool.query<{ secret: string; status: string }>(`select secret, status from auth.mfa_factors where id = $1 and user_id = $2`, [fid, claims.sub]);
          if (!f.rowCount || challenges.get(String(b.challenge_id)) !== fid) return send(res, 400, { code: 400, error_code: 'mfa_challenge_expired', msg: 'MFA challenge has expired, verify against another challenge or create a new challenge.' }, origin);
          challenges.delete(String(b.challenge_id));
          if (!totpValid(f.rows[0]!.secret, String(b.code))) return send(res, 400, { code: 400, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' }, origin);
          await pool.query(`update auth.mfa_factors set status = 'verified' where id = $1`, [fid]);
          const u = await pool.query<{ email: string; app_metadata: object }>(`select email, app_metadata from auth.users where id = $1`, [claims.sub]);
          return send(res, 200, await session(claims.sub, u.rows[0]!.email, u.rows[0]!.app_metadata, 'aal2'), origin);
        }
        return send(res, 404, { message: 'not found' }, origin);
      }
      // ---- Auth admin API (service key only)
      const admin = /^\/auth\/v1\/admin\/users(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname);
      if (admin) {
        if (bearer !== LOCAL_SERVICE_KEY) return send(res, 403, { code: 403, error_code: 'not_admin', msg: 'User not allowed' }, origin);
        const id = admin[1];
        if (!id && req.method === 'POST') {
          const b = await readBody(req);
          const email = String(b.email ?? '').toLowerCase();
          const dupe = await pool.query(`select 1 from auth.users where email = $1`, [email]);
          if (dupe.rowCount) return send(res, 422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' }, origin);
          const r = await pool.query<{ id: string }>(`insert into auth.users (email, password, app_metadata) values ($1,$2,$3) returning id`, [email, b.password ?? null, JSON.stringify(b.app_metadata ?? {})]);
          return send(res, 200, await userJson(r.rows[0]!.id, email, b.app_metadata ?? {}), origin);
        }
        if (id && req.method === 'GET') {
          const cur = await pool.query<{ email: string; app_metadata: object }>(`select email, app_metadata from auth.users where id = $1`, [id]);
          if (!cur.rows[0]) return send(res, 404, { code: 404, error_code: 'user_not_found', msg: 'User not found' }, origin);
          return send(res, 200, await userJson(id, cur.rows[0].email, cur.rows[0].app_metadata), origin);
        }
        if (id && req.method === 'PUT') {
          const b = await readBody(req);
          const cur = await pool.query<{ email: string; app_metadata: object }>(`select email, app_metadata from auth.users where id = $1`, [id]);
          if (!cur.rows[0]) return send(res, 404, { code: 404, error_code: 'user_not_found', msg: 'User not found' }, origin);
          const meta = { ...cur.rows[0].app_metadata, ...(b.app_metadata ?? {}) };
          const email = b.email ? String(b.email).toLowerCase() : cur.rows[0].email;
          if (email !== cur.rows[0].email && (await pool.query(`select 1 from auth.users where email = $1`, [email])).rowCount) {
            return send(res, 422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' }, origin);
          }
          await pool.query(`update auth.users set password = coalesce($2, password), app_metadata = $3, email = $4 where id = $1`, [id, b.password ?? null, JSON.stringify(meta), email]);
          return send(res, 200, await userJson(id, email, meta), origin);
        }
        if (id && req.method === 'DELETE') {
          await pool.query(`delete from auth.users where id = $1`, [id]);
          return send(res, 200, {}, origin);
        }
      }
      // ---- Storage: same access rules as the real bucket (RLS on storage.objects, 2 MB, images only)
      const up = /^\/storage\/v1\/object\/menu-images\/(.+)$/.exec(url.pathname);
      if (up && req.method === 'POST') {
        const claims = bearer ? verifyJwt(bearer) : null;
        if (!claims) return send(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'invalid JWT' }, origin);
        const path = decodeURIComponent(up[1]!);
        const raw = await readRaw(req);
        const file = multipartFile(raw, String(req.headers['content-type'] ?? '')) ?? { data: raw, type: String(req.headers['content-type'] ?? '') };
        if (!ALLOWED_TYPES.has(file.type)) return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${file.type} is not supported` }, origin);
        if (file.data.length > MAX_UPLOAD_BYTES) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }, origin);
        if (files.has(path)) return send(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, origin);
        const c = await pool.connect();
        try {
          await c.query('begin');
          await c.query('set local role authenticated');
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: claims.sub, role: 'authenticated', aal: claims.aal })]);
          await c.query(`insert into storage.objects (bucket_id, name, owner) values ('menu-images', $1, $2)`, [path, claims.sub]);
          await c.query('commit');
        } catch {
          await c.query('rollback').catch(() => undefined);
          return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, origin);
        } finally {
          c.release();
        }
        files.set(path, file);
        return send(res, 200, { Id: randomUUID(), Key: `menu-images/${path}` }, origin);
      }
      if (url.pathname === '/storage/v1/object/copy' && req.method === 'POST') {
        if (bearer !== LOCAL_SERVICE_KEY) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'service key required' }, origin);
        const b = await readBody(req);
        const src = files.get(String(b.sourceKey ?? ''));
        if (!src) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' }, origin);
        const dest = String(b.destinationKey ?? '');
        files.set(dest, src);
        await pool.query(`insert into storage.objects (bucket_id, name) values ('menu-images', $1) on conflict do nothing`, [dest]).catch(() => undefined);
        return send(res, 200, { Key: `menu-images/${dest}` }, origin);
      }
      const pub = /^\/storage\/v1\/object\/public\/menu-images\/(.+)$/.exec(url.pathname);
      if (pub && req.method === 'GET') {
        const f = files.get(decodeURIComponent(pub[1]!));
        if (!f) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' }, origin);
        res.writeHead(200, { 'content-type': f.type, 'cache-control': 'public, max-age=60', ...(origin ? { 'access-control-allow-origin': origin } : {}), 'cross-origin-resource-policy': 'cross-origin' });
        res.end(f.data);
        return;
      }
      if (url.pathname === '/auth/v1/logout' && req.method === 'POST') return send(res, 204, undefined, origin);

      const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
      if (m && req.method === 'POST') {
        let role: 'service_role' | 'authenticated' | 'anon' = 'anon';
        let sub: string | undefined;
        let aal: 'aal1' | 'aal2' = 'aal1';
        if (bearer === LOCAL_SERVICE_KEY) role = 'service_role';
        else if (bearer && bearer !== LOCAL_ANON_KEY) {
          const claims = verifyJwt(bearer);
          if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid or expired' }, origin);
          role = 'authenticated';
          sub = claims.sub;
          aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
        }
        const r = await callRpc(pool, role, m[1]!, await readBody(req), sub, aal);
        if (r.error) return send(res, r.error.code === '42501' ? 403 : 400, r.error, origin);
        return send(res, 200, r.data, origin);
      }
      send(res, 404, { message: 'not found' }, origin);
    } catch (e) {
      send(res, 500, { message: String(e) }, origin);
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
