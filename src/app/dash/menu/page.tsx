import { MenuManager } from '@/components/dash/MenuManager';
import { dashContext } from '@/lib/dash/context';

export default async function MenuPage() {
  const c = await dashContext();
  return <MenuManager restaurantId={c.me.restaurant.id} supabase={c.supabase} imageBase={c.imageBase} />;
}
