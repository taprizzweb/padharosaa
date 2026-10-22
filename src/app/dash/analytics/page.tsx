import { AnalyticsView } from '@/components/dash/AnalyticsView';
import { dashContext } from '@/lib/dash/context';

export default async function AnalyticsPage() {
  await dashContext();
  return <AnalyticsView />;
}
