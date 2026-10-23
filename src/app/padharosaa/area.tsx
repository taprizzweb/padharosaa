import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { DeskApp } from '@/components/padharosaa/DeskApp';
import { ManageApp } from '@/components/padharosaa/ManageApp';
import { publicEnv } from '@/env';
import { AREA_TITLE, areaHref, canOpen, groupOf, homeFor, isPadHost, type Area } from '@/lib/padharosaa/areas';
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
  const teams = ((al as { teams?: string[] | null } | null)?.teams ?? []) as string[];
  if (!canOpen(area, m.role, teams)) {
    const home = homeFor(m.role, teams);
    if (home && home !== area) redirect(areaHref(home, pad));
    return <main className="p-8 text-center"><h1 className="text-2xl font-extrabold">No access</h1><p className="mt-3">This page is not for your role.</p></main>;
  }
  if (area === 'owner' || area === 'manager') {
    const env = publicEnv();
    return <ManageApp role={m.role} restaurant={m.restaurant} supabase={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }} />;
  }
  return <DeskApp role={m.role} hotel={m.restaurant.name} title={AREA_TITLE[area]} current={area} start={groupOf(area)} />;
}
