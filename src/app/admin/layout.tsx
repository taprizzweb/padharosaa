import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AdminNav } from '@/components/admin/AdminNav';
import { rpc } from '@/lib/guest/rpc';
import { userClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Platform admin', robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect('/login?next=/admin');
  // Anyone who is not a platform admin sees an ordinary "not found" page: /admin does not reveal that it exists.
  if (!(await rpc<boolean>('admin_check', { p_user: data.user.id }))) notFound();
  return (
    <div data-accent="slate" className="min-h-dvh bg-stone-50">
      <AdminNav />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4">{children}</div>
    </div>
  );
}
