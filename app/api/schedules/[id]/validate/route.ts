import { requireScheduler } from '@/lib/server/auth'
import { respond } from '@/lib/server/route'
import { loadScheduleContext, validateSchedule } from '@/lib/server/schedule-service'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireScheduler()
    const { id } = await params
    const ctx = await loadScheduleContext(id)
    const violations = await validateSchedule(ctx)
    return { violations }
  })
}
