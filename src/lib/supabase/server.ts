import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { serverEnv } from '@/env';

/**
 * Database client that acts AS THE SIGNED-IN STAFF MEMBER (their JWT from the session cookie), so row level
 * security and the role checks inside the SQL functions apply. Never the service role.
 * Always identify the user with auth.getUser() (verified by Supabase), never with getSession() on the server.
 */
export async function userClient(): Promise<SupabaseClient> {
  const jar = await cookies();
  const env = serverEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: { sameSite: 'lax', secure: env.NEXT_PUBLIC_APP_ORIGIN.startsWith('https://') },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; middleware refreshes the session instead.
        }
      },
    },
  });
}
