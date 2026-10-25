import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DashNav } from '@/components/dash/DashNav';
import type { StaffMe } from '@/components/staff/StaffApp';
import { describeExpiry, expiryOf, istDate } from '@/lib/billing';
import { userClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect('/login?next=/dash/menu');
  const { data: me } = await db.rpc('staff_me');
  const m = me as StaffMe | null;
  if (!m) redirect('/staff');
  // Waiters and kitchen staff only use the live screen.
  if (m.role !== 'owner' && m.role !== 'manager') redirect('/staff');
  // Warn in time: the plan end date is set by the platform admin; nothing here changes it.
  const { data: st } = await db.rpc('mgr_get_settings');
  const plan = st as { paid_until: string | null; auto_pause: boolean; grace_days: number } | null;
  const ex = plan ? expiryOf(plan.paid_until, plan.auto_pause, plan.grace_days) : ({ kind: 'none' } as const);
  const planMsg =
    ex.kind === 'soon' || ex.kind === 'grace' || ex.kind === 'ended'
      ? `Your plan ${ex.kind === 'soon' ? 'ends' : 'ended'} on ${istDate(plan!.paid_until)} (${describeExpiry(ex).toLowerCase()}). ${ex.kind === 'ended' && ex.paused ? 'Your menu is paused: guests cannot order. ' : ''}Please contact support to renew.`
      : null;
  return (
    <div data-accent={m.restaurant.accent} className="min-h-dvh bg-stone-50">
      <DashNav name={m.restaurant.name} role={m.role} slug={m.restaurant.slug} support={m.display_name === 'Taprizz admin (support)'} />
      {m.restaurant.status !== 'active' && (
        <p role="status" className="bg-amber-100 px-4 py-3 text-center text-sm font-semibold text-amber-900">This restaurant is paused, so changes are switched off. Please contact support.</p>
      )}
      {planMsg && (
        <p role="status" data-testid="plan-notice" className={`px-4 py-3 text-center text-sm font-semibold ${ex.kind === 'ended' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>{planMsg}</p>
      )}
      <div id="dash-main" className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 print:max-w-none print:p-0" data-role={m.role}>{children}</div>
    </div>
  );
}
