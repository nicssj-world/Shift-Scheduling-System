import { DashboardView } from '@/components/dashboard/dashboard-view'
import { requireDashboardPageActor } from '@/lib/server/auth'

export default async function DashboardPage() {
  await requireDashboardPageActor()
  return <DashboardView />
}
