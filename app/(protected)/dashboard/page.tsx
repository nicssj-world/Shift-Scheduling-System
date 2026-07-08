import { DashboardView } from '@/components/dashboard/dashboard-view'
import { requireSchedulerPageActor } from '@/lib/server/auth'

export default async function DashboardPage() {
  await requireSchedulerPageActor()
  return <DashboardView />
}
