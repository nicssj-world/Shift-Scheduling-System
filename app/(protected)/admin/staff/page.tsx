import { StaffAdminView } from '@/components/admin/staff-admin-view'
import { requireSchedulerPageActor } from '@/lib/server/auth'

export default async function AdminStaffPage() {
  await requireSchedulerPageActor()
  return <StaffAdminView />
}
