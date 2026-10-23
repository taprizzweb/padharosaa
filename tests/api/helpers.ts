import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { callRpc } from '../../supabase/tests/helpers/rpc';
import { newSecret, totpValid } from '../../supabase/tests/helpers/totp';

export const APP = 'https://gotomenu.taprizz.in';

export const state = {
  pool: null as null | Pool,
  /** when set, the next rpc fails with this database error (simulates an unexpected failure) */
  forceError: null as null | { code: string; message: string },
  calls: [] as string[],
};

/** What the server code gets instead of the real Supabase client: same rpc() contract, real SQL underneath. */
export const storageState = { copied: [] as [string, string][], failOn: new Set<string>() };
export const fakeAdminClient = {
  storage: {
    from: () => ({
      copy: async (from: string, to: string) => {
        if (storageState.failOn.has(from)) return { data: null, error: { message: 'copy failed' } };
        storageState.copied.push([from, to]);
        return { data: { path: to }, error: null };
      },
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ data: [], error: null }),
    }),
  },
  auth: {
    admin: {
      createUser: async ({ email, password, app_metadata }: { email: string; password: string; app_metadata?: Record<string, unknown> }) => {
        const exists = await state.pool!.query(`select 1 from auth.users where email = $1`, [email]);
        if (exists.rowCount) return { data: { user: null }, error: { status: 422, message: 'A user with this email address has already been registered' } };
        const r = await state.pool!.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
        const id = r.rows[0]!.id;
        authState.meta.set(id, { password, app_metadata: app_metadata ?? {} });
        return { data: { user: { id } }, error: null };
      },
      getUserById: async (id: string) => {
        const r = await state.pool!.query<{ email: string }>(`select email from auth.users where id = $1`, [id]);
        return { data: { user: r.rows[0] ? { id, email: r.rows[0].email } : null }, error: null };
      },
      updateUserById: async (id: string, attrs: { password?: string; email?: string; app_metadata?: Record<string, unknown> }) => {
        if (attrs.email) {
          const taken = await state.pool!.query(`select 1 from auth.users where email = $1 and id <> $2`, [attrs.email, id]);
          if (taken.rowCount) return { data: { user: null }, error: { status: 422, message: 'A user with this email address has already been registered' } };
          await state.pool!.query(`update auth.users set email = $1 where id = $2`, [attrs.email, id]);
        }
        const m = authState.meta.get(id) ?? { app_metadata: {} };
        authState.meta.set(id, { password: attrs.password ?? m.password, app_metadata: { ...m.app_metadata, ...(attrs.app_metadata ?? {}) } });
        return { data: { user: { id } }, error: null };
      },
      deleteUser: async (id: string) => {
        authState.deleted.push(id);
        await state.pool!.query(`delete from auth.users where id = $1`, [id]);
        return { data: {}, error: null };
      },
    },
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push(name);
    if (state.forceError) {
      const e = state.forceError;
      state.forceError = null;
      return { data: null, error: e };
    }
    return callRpc(state.pool!, 'service_role', name, args);
  },
};

/** The signed-in staff member for the next request (what the session cookie would prove). */
export const authState = {
  userId: null as string | null,
  signOuts: [] as string[],
  /** per-user login details the fake Auth service remembers (password and server-only metadata) */
  meta: new Map<string, { password?: string; app_metadata: Record<string, unknown> }>(),
  deleted: [] as string[],
  /** assurance level of the current session: aal2 = password + second factor (the default keeps older tests simple) */
  aal: 'aal2' as 'aal1' | 'aal2',
  /** second factors the fake Auth service knows, per user */
  factors: new Map<string, { id: string; secret: string; status: 'unverified' | 'verified' }[]>(),
};
const fakeToken = () => `h.${Buffer.from(JSON.stringify({ aal: authState.aal })).toString('base64url')}.s`;

/**
 * Stand-in for the cookie-based Supabase client: getUser() answers with `authState.userId`, rpc() runs the real SQL
 * as that user (authenticated role), and signInWithPassword() accepts the demo password for any existing auth user.
 */
export const fakeUserClient = {
  auth: {
    getUser: async () => {
      if (!authState.userId) return { data: { user: null }, error: { status: 401, message: 'no session' } };
      const email = (await state.pool!.query<{ email: string }>(`select email from auth.users where id = $1`, [authState.userId])).rows[0]?.email;
      return { data: { user: { id: authState.userId, email, app_metadata: authState.meta.get(authState.userId)?.app_metadata ?? {} } }, error: null };
    },
    updateUser: async ({ password }: { password?: string }) => {
      if (!authState.userId) return { data: { user: null }, error: { status: 401, message: 'no session' } };
      if (password && /^(password|123456)/i.test(password)) return { data: { user: null }, error: { status: 422, message: 'Password is known to be weak and easy to guess' } };
      const m = authState.meta.get(authState.userId) ?? { app_metadata: {} };
      authState.meta.set(authState.userId, { ...m, password: password ?? m.password });
      return { data: { user: { id: authState.userId } }, error: null };
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      const r = await state.pool!.query<{ id: string }>(`select id from auth.users where email = $1`, [email]);
      if (r.rowCount === 0 || password !== 'correct-horse-battery-staple') return { data: { session: null }, error: { status: 400, message: 'Invalid login credentials' } };
      authState.userId = r.rows[0]!.id;
      return { data: { session: {} }, error: null };
    },
    getSession: async () => ({ data: { session: authState.userId ? { access_token: fakeToken() } : null }, error: null }),
    mfa: {
      listFactors: async () => {
        const all = (authState.factors.get(authState.userId ?? '') ?? []).map((f) => ({ id: f.id, status: f.status, factor_type: 'totp' }));
        return { data: { all, totp: all.filter((f) => f.status === 'verified') }, error: null };
      },
      enroll: async () => {
        const f = { id: randomUUID(), secret: newSecret(), status: 'unverified' as const };
        authState.factors.set(authState.userId!, [...(authState.factors.get(authState.userId!) ?? []), f]);
        return { data: { id: f.id, type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf8,%3Csvg%2F%3E', secret: f.secret, uri: 'otpauth://x' } }, error: null };
      },
      unenroll: async ({ factorId }: { factorId: string }) => {
        authState.factors.set(authState.userId!, (authState.factors.get(authState.userId!) ?? []).filter((f) => f.id !== factorId));
        return { data: { id: factorId }, error: null };
      },
      challenge: async ({ factorId }: { factorId: string }) => ({ data: { id: `ch-${factorId}` }, error: null }),
      verify: async ({ factorId, code }: { factorId: string; challengeId: string; code: string }) => {
        const f = (authState.factors.get(authState.userId ?? '') ?? []).find((x) => x.id === factorId);
        if (!f || !totpValid(f.secret, code)) return { data: null, error: { status: 400, message: 'Invalid TOTP code entered' } };
        f.status = 'verified';
        authState.aal = 'aal2';
        return { data: {}, error: null };
      },
    },
    signOut: async (o?: { scope?: string }) => {
      authState.signOuts.push(o?.scope ?? 'global');
      authState.userId = null;
      return { error: null };
    },
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push(name);
    if (!authState.userId) return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
    return callRpc(state.pool!, 'authenticated', name, args, authState.userId, authState.aal);
  },
};

export interface PostOpts {
  origin?: string | null;
  referer?: string;
  contentType?: string | null;
  cookie?: string;
  ip?: string;
  rawBody?: string;
  method?: string;
  /** serve the request as if it came in on this host (x-forwarded-host), e.g. padharosaa.taprizz.in */
  host?: string;
}

export function req(path: string, body?: unknown, o: PostOpts = {}): Request {
  const headers = new Headers();
  if (o.host) headers.set('x-forwarded-host', o.host);
  if (o.origin !== null) headers.set('origin', o.origin ?? (o.host ? `https://${o.host}` : APP));
  if (o.referer) headers.set('referer', o.referer);
  if (o.contentType !== null) headers.set('content-type', o.contentType ?? 'application/json');
  if (o.cookie) headers.set('cookie', o.cookie);
  headers.set('x-forwarded-for', o.ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}`);
  const method = o.method ?? (body === undefined && o.rawBody === undefined ? 'GET' : 'POST');
  const init: RequestInit = { method, headers };
  if (method === 'POST') init.body = o.rawBody ?? JSON.stringify(body);
  return new Request(`${APP}${path}`, init);
}

/** "gm_sid=..." pair from a response's Set-Cookie, ready to send back. */
export function cookieFrom(res: Response): string | undefined {
  const sc = res.headers.getSetCookie().find((c) => c.startsWith('gm_sid='));
  return sc?.split(';')[0];
}

export const uniqueIp = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}-${randomUUID().slice(0, 6)}`;
