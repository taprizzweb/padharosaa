import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { StaffShell } from '@/components/padharosaa/StaffShell';
import { DeskApp } from '@/components/padharosaa/DeskApp';
import { StaffApp, type StaffMe } from '@/components/staff/StaffApp';
import { InventoryApp } from '@/components/inventory/InventoryApp';
import { RoomsApp } from '@/components/frontoffice/RoomsApp';
import { BillingApp } from '@/components/billing/BillingApp';
import { QrSheet } from '@/components/padharosaa/QrSheet';
import { ManageApp } from '@/components/padharosaa/ManageApp';
import { StaffSettings } from '@/components/padharosaa/StaffSettings';
import { publicEnv } from '@/env';
import { areaHref, canOpen, homeFor, isPadHost, type Area } from '@/lib/padharosaa/areas';
import { userClient } from '@/lib/supabase/server';

// One server-side gate for every named page: signed in, active staff, and the right page for the person's role.
// Someone on the wrong page is sent to their own, never shown another team's screen.
export async function renderArea(area: Area) {
  const h = await headers();
  const pad = isPadHost(h.get('x-forwarded-host') ?? h.get('host'));
  const db = await userClient();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect(`/login?next=${encodeURIComponent(`/padharosaa/${area}`)}`);
  const { data: me } = await db.rpc('staff_me');
  const m = me as { role: string; restaurant: { id: string; name: string; slug: string } } | null;
  if (!m) return <main className="p-8 text-center"><h1 className="text-2xl font-extrabold">No access</h1><p className="mt-3">This account is not an active staff member. Please ask your manager.</p></main>;
  const { data: al } = await db.rpc('padh_my_alerts');
  const kitchenDisplay = !!(al as { kitchen_display?: boolean } | null)?.kitchen_display;
  if (!canOpen(area, m.role)) {
    const home = homeFor(m.role);
    if (home && home !== area) redirect(areaHref(home, pad));
    return <main className="p-8 text-center"><h1 className="text-2xl font-extrabold">No access</h1><p className="mt-3">This page is not for your role.</p></main>;
  }
  const env = publicEnv();
  const supabase = { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  const meta = me as { display_name?: string; name?: string };
  const content = (() => {
    if (area === 'owner' || area === 'manager') return <ManageApp role={m.role} restaurant={m.restaurant} supabase={supabase} />;
    if (area === 'qr') return <QrSheet hotel={m.restaurant.name} />;
    if (area === 'inventory') return <InventoryApp role={m.role} />;
    if (area === 'rooms') return <RoomsApp role={m.role} />;
    if (area === 'billing') return <BillingApp role={m.role} />;
    if (area === 'settings') return <StaffSettings role={m.role} name={meta.display_name ?? meta.name ?? '—'} email={data.user.email ?? null} />;
    // The menu for staff who are not owner or manager: the sold-out switches (what is finished today). Adding or deleting dishes stays with the owner and manager.
    if (area === 'menu') return <StaffApp me={me as StaffMe} hotel soldOutOnly supabase={supabase} />;
    // The kitchen has ONE screen: every food order (from the hotel menu, room delivery or takeaway) and the sold-out switches for the menu.
    if (area === 'kitchen') return <StaffApp me={me as StaffMe} hotel supabase={supabase} />;
    return <DeskApp role={m.role} />;
  })();
  return (
    <StaffShell role={m.role} hotel={m.restaurant.name} name={meta.display_name ?? meta.name ?? ''} current={area} kitchenDisplay={kitchenDisplay}>{content}</StaffShell>
  );
}
