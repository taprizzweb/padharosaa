import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AreaNav } from '@/components/padharosaa/AreaNav';
import { DeskApp } from '@/components/padharosaa/DeskApp';
import { StaffApp, type StaffMe } from '@/components/staff/StaffApp';
import { BillingApp } from '@/components/billing/BillingApp';
import { QrSheet } from '@/components/padharosaa/QrSheet';
import { ManageApp } from '@/components/padharosaa/ManageApp';
import { StaffSettings } from '@/components/padharosaa/StaffSettings';
import { publicEnv } from '@/env';
import { AREA_TITLE, areaHref, canOpen, homeFor, isPadHost, type Area } from '@/lib/padharosaa/areas';
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
  if (area === 'owner' || area === 'manager') {
    const env = publicEnv();
    return <ManageApp role={m.role} restaurant={m.restaurant} supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }} />;
  }
  if (area === 'qr') return <QrSheet hotel={m.restaurant.name} />;
  if (area === 'billing') return <BillingApp role={m.role} hotel={m.restaurant.name} />;
  if (area === 'settings') {
    const meta = me as { display_name?: string; name?: string };
    return <StaffSettings role={m.role} name={meta.display_name ?? meta.name ?? '—'} email={data.user.email ?? null} hotel={m.restaurant.name} />;
  }
  if (area === 'menu') {
    // The menu for staff who are not owner or manager: the sold-out switches (what is finished today). Adding or deleting dishes stays with the owner and manager.
    const env = publicEnv();
    return (
      <>
        <div className="mx-auto max-w-5xl px-4 pt-3"><AreaNav role={m.role} current="menu" kitchenDisplay={kitchenDisplay} alarm={false} /></div>
        <StaffApp me={me as StaffMe} hotel soldOutOnly supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }} />
      </>
    );
  }
  if (area === 'kitchen') {
    // The kitchen has ONE screen: every food order (from the hotel menu, room delivery or takeaway) and the sold-out switches for the menu.
    const env = publicEnv();
    return (
      <>
        {(m.role === 'owner' || m.role === 'manager') && <div className="mx-auto max-w-5xl px-4 pt-3"><AreaNav role={m.role} current="kitchen" kitchenDisplay={kitchenDisplay} alarm={false} /></div>}
        <StaffApp me={me as StaffMe} hotel supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }} />
      </>
    );
  }
  return <DeskApp role={m.role} hotel={m.restaurant.name} title={AREA_TITLE[area]} current="desk" />;
}
