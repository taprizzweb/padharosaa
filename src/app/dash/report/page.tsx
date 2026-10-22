import { ReportView } from '@/components/dash/ReportView';
import { dashContext } from '@/lib/dash/context';

export default async function ReportPage() {
  await dashContext();
  return <ReportView />;
}
