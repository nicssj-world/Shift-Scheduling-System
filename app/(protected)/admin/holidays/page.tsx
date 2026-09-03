import { HolidaysView } from '@/components/admin/holidays-view'
import { requireSchedulerPageActor } from '@/lib/server/auth'

export default async function AdminHolidaysPage() {
  await requireSchedulerPageActor()
  return <HolidaysView />
}
