import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fromDbError } from '@/lib/errors';

/** Calls a SQL function as the signed-in staff member. Known database errors become ApiErrors. */
export async function staffRpc<T>(db: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const known = fromDbError(error);
    if (known) throw known;
    // JWT problems (expired / invalid) surface as 401-ish PostgREST errors
    if (error.code === 'PGRST301' || error.code === 'PGRST303') {
      const { ApiError } = await import('@/lib/errors');
      throw new ApiError(401, 'unauthorized');
    }
    throw Object.assign(new Error(`rpc ${name} failed`), { dbCode: error.code });
  }
  return data as T;
}
