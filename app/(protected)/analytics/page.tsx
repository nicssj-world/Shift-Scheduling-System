import { AnalyticsView } from '@/components/analytics/analytics-view'
import { requireSchedulerPageActor } from '@/lib/server/auth'

export default async function AnalyticsPage() {
  await requireSchedulerPageActor()
  return <AnalyticsView />
}
