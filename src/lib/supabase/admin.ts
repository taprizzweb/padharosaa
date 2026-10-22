import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/env';

let client: SupabaseClient | undefined;

/**
 * Service-role client. SERVER ONLY. It can call the guest_* / admin_* SQL functions and nothing else
 * (table privileges are revoked in migration 0001). Never import this from a client component.
 */
export function adminClient(): SupabaseClient {
  const env = serverEnv();
  client ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'gotomenu-server' } },
  });
  return client;
}
