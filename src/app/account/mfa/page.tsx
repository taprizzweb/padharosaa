import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { aalFromToken } from '@/lib/auth/aal';
import { safeNext } from '@/lib/schemas/staff';
import { userClient } from '@/lib/supabase/server';
import { MfaForm } from './MfaForm';

export const metadata: Metadata = { title: 'Two-step sign-in' };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const to = safeNext(next);
  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect('/login');
  const { data: sess } = await db.auth.getSession();
  if (aalFromToken(sess.session?.access_token) === 'aal2') redirect(to);
  const { data: factors } = await db.auth.mfa.listFactors();
  const verified = factors?.totp?.[0]; // listFactors().totp only holds VERIFIED factors
  return <MfaForm factorId={verified?.id ?? null} next={to} />;
}
