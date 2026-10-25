import { redirect } from 'next/navigation';
import { MenuManager } from '@/components/dash/MenuManager';
import { dashContext } from '@/lib/dash/context';

export default async function MenuPage() {
  const c = await dashContext();
  if (c.menuLocked) redirect('/dash/settings'); // a hotel's menu is edited by the Taprizz admin only
  return <MenuManager restaurantId={c.me.restaurant.id} supabase={c.supabase} imageBase={c.imageBase} />;
}
