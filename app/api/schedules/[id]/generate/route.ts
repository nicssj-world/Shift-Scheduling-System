import { requireScheduler } from '@/lib/server/auth'
import { respond } from '@/lib/server/route'
import { loadScheduleContext, runGenerate } from '@/lib/server/schedule-service'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireScheduler()
    const { id } = await params
    const ctx = await loadScheduleContext(id)
    const result = await runGenerate(ctx, actor.id)
    return { violations: result.violations, stats: result.stats, count: result.assignments.length }
  })
}
