import { HolidaysView } from '@/components/admin/holidays-view'
import { requireAdminPageActor } from '@/lib/server/auth'

export default async function AdminHolidaysPage() {
  await requireAdminPageActor()
  return <HolidaysView />
}
