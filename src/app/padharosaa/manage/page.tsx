import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ManageApp } from '@/components/padharosaa/ManageApp';
import { publicEnv } from '@/env';
import { userClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Padharosaa manage', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Owner and manager: texts, Wi-Fi, colour and logo, links, dining switch, team. Everything saves through the checked API.
export default async function ManagePage() {
  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect('/login?next=/padharosaa/manage');
  const { data: me } = await db.rpc('staff_me');
  const m = me as { role: string; restaurant: { id: string; name: string; slug: string } } | null;
  if (!m) redirect('/staff');
  if (m.role !== 'owner' && m.role !== 'manager') redirect('/padharosaa/desk');
  const env = publicEnv();
  return <ManageApp role={m.role} restaurant={m.restaurant} supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }} appOrigin={env.NEXT_PUBLIC_PADHAROSAA_ORIGIN ?? env.NEXT_PUBLIC_APP_ORIGIN} />;
}
