import { StaffAdminView } from '@/components/admin/staff-admin-view'
import { requireAdminPageActor } from '@/lib/server/auth'

export default async function AdminStaffPage() {
  await requireAdminPageActor()
  return <StaffAdminView />
}
