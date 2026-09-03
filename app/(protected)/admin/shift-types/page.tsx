import { ShiftTypesView } from '@/components/admin/shift-types-view'
import { requireSchedulerPageActor } from '@/lib/server/auth'

export default async function AdminShiftTypesPage() {
  await requireSchedulerPageActor()
  return <ShiftTypesView />
}
