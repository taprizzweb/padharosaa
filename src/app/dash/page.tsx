import { redirect } from 'next/navigation';
import { dashContext } from '@/lib/dash/context';

export default async function DashHome() {
  const c = await dashContext();
  redirect(c.menuLocked ? '/dash/settings' : '/dash/menu');
}
