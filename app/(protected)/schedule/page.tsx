import { Suspense } from 'react'
import { ScheduleView } from '@/components/schedule/schedule-view'
import { Spinner } from '@/components/ui'

export default function SchedulePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ScheduleView manage={false} />
    </Suspense>
  )
}
