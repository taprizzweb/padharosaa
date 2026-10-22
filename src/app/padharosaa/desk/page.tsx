import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DeskApp } from '@/components/padharosaa/DeskApp';
import { userClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Padharosaa desk', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Reception, kitchen and managers: the live request board. Signed-in staff only (the middleware also guards this path).
export default async function DeskPage() {
  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect('/login?next=/padharosaa/desk');
  const { data: me } = await db.rpc('staff_me');
  const m = me as { role: string; restaurant: { name: string } } | null;
  if (!m) return <main className="p-8 text-center"><h1 className="text-2xl font-extrabold">No access</h1><p className="mt-3">This account is not an active staff member. Please ask your manager.</p></main>;
  return <DeskApp role={m.role} hotel={m.restaurant.name} />;
}
