import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/env';

/** Checks someone's own password again, on a throw-away client (no cookies, no stored session). Used before an action that cannot be undone. */
export async function passwordIsRight(email: string, password: string): Promise<boolean> {
  const env = serverEnv();
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (data.session) await c.auth.signOut().catch(() => undefined);
  return !error && !!data.session;
}
