import 'server-only';
import { redirect } from 'next/navigation';
import type { StaffMe } from '@/components/staff/StaffApp';
import { publicEnv } from '@/env';
import { userClient } from '@/lib/supabase/server';

/** Who is looking at a dashboard page (the layout already blocked everyone but owner / manager; this re-checks and hands over the facts). */
export async function dashContext() {
  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect('/login?next=/dash/menu');
  const { data: me } = await db.rpc('staff_me');
  const m = me as StaffMe | null;
  if (!m || (m.role !== 'owner' && m.role !== 'manager')) redirect('/staff');
  const env = publicEnv();
  return {
    me: m,
    supabase: { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    imageBase: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/menu-images/`,
    appOrigin: env.NEXT_PUBLIC_APP_ORIGIN,
  };
}
