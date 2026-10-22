import { AuditView } from '@/components/dash/AuditView';
import { dashContext } from '@/lib/dash/context';

export default async function AuditPage() {
  await dashContext();
  return <AuditView />;
}
