import { StaffManager } from '@/components/dash/StaffManager';
import { dashContext } from '@/lib/dash/context';

export default async function StaffPage() {
  const c = await dashContext();
  return <StaffManager canEdit={c.me.role === 'owner'} />;
}
