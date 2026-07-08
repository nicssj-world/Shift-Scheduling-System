import { ShiftTypesView } from '@/components/admin/shift-types-view'
import { requireAdminPageActor } from '@/lib/server/auth'

export default async function AdminShiftTypesPage() {
  await requireAdminPageActor()
  return <ShiftTypesView />
}
