import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StaffApp, type StaffMe } from '@/components/staff/StaffApp';
import { publicEnv } from '@/env';
import { userClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Staff',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Taprizz', statusBarStyle: 'black-translucent' },
};

export default async function StaffPage() {
  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect('/login?next=/staff');
  const { data: me } = await db.rpc('staff_me');
  if (!me) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-extrabold">No access</h1>
        <p className="mt-3 text-stone-700">This account is not an active staff member of any restaurant. Please ask your manager.</p>
      </main>
    );
  }
  const env = publicEnv();
  const { data: alerts } = await db.rpc('padh_my_alerts'); // answers only for staff of an enabled Padharosaa hotel
  return <StaffApp me={me as StaffMe} hotel={!!alerts} supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }} />;
}
