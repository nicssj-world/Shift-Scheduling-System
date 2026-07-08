import { Suspense } from 'react'
import { ScheduleView } from '@/components/schedule/schedule-view'
import { Spinner } from '@/components/ui'
import { requireSchedulerPageActor } from '@/lib/server/auth'

export default async function ScheduleManagePage() {
  await requireSchedulerPageActor()
  return (
    <Suspense fallback={<Spinner />}>
      <ScheduleView manage={true} />
    </Suspense>
  )
}
