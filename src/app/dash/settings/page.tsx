import { SettingsForm } from '@/components/dash/SettingsForm';
import { dashContext } from '@/lib/dash/context';

export default async function SettingsPage() {
  const c = await dashContext();
  return <SettingsForm canEdit={c.me.role === 'owner'} supabase={c.supabase} imageBase={c.imageBase} />;
}
