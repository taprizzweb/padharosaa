import type { Pool } from 'pg';

/**
 * Calls a public SQL function the way Supabase's REST layer (PostgREST) does for a given database role:
 * named arguments, results shaped as PostgREST returns them, errors as { code, message, details, hint }.
 * Used by the API tests and by the local dev server so route handlers run against real SQL.
 */
export interface RpcResult {
  data: unknown;
  error: { code: string; message: string; details?: string | null; hint?: string | null } | null;
}

interface FnInfo {
  names: string[] | null;
  types: string[];
  retset: boolean;
  ret: string;
}
const cache = new Map<string, FnInfo>();

async function info(pool: Pool, name: string): Promise<FnInfo | null> {
  const hit = cache.get(name);
  if (hit) return hit;
  const r = await pool.query(
    `select p.proargnames as names,
            coalesce((select array_agg(format_type(t, null) order by o) from unnest(p.proargtypes) with ordinality u(t, o)), '{}') as types,
            p.proretset as retset, format_type(p.prorettype, null) as ret
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  if (r.rowCount !== 1) return null;
  const row = r.rows[0] as FnInfo;
  cache.set(name, row);
  return row;
}

export async function callRpc(pool: Pool, role: 'service_role' | 'anon' | 'authenticated', name: string, args: Record<string, unknown> = {}, userId?: string, aal: 'aal1' | 'aal2' = 'aal2'): Promise<RpcResult> {
  const client = await pool.connect();
  try {
    const fn = await info(pool, name);
    if (!fn || !/^[a-z_]+$/.test(name)) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    const keys = Object.keys(args);
    const params: unknown[] = [];
    const parts = keys.map((k, i) => {
      const idx = fn.names?.indexOf(k) ?? -1;
      if (idx < 0 || !/^[a-z_]+$/.test(k)) throw Object.assign(new Error('bad arg'), { code: 'PGRST202' });
      const type = fn.types[idx]!;
      const v = args[k];
      params.push(type === 'jsonb' || type === 'json' ? JSON.stringify(v) : v);
      return `${k} => $${i + 1}::${type}`;
    });
    await client.query('begin');
    await client.query(`set local role ${role}`);
    if (userId) await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role, aal })]);
    const sql = fn.retset ? `select * from public.${name}(${parts.join(', ')})` : `select public.${name}(${parts.join(', ')}) as r`;
    const res = await client.query(sql, params);
    await client.query('commit');
    if (fn.retset) return { data: res.rows, error: null };
    const v = (res.rows[0] as { r: unknown }).r;
    return { data: fn.ret === 'void' ? null : v, error: null };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    const err = e as { code?: string; message: string; detail?: string; hint?: string };
    return { data: null, error: { code: err.code ?? 'XX000', message: err.message, details: err.detail ?? null, hint: err.hint ?? null } };
  } finally {
    client.release();
  }
}
