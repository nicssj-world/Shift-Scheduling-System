import { requireScheduler } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'
import { getCandidates, loadScheduleContext } from '@/lib/server/schedule-service'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireScheduler()
    const { id } = await params
    const url = new URL(request.url)
    const date = url.searchParams.get('date')
    const shiftTypeId = url.searchParams.get('shiftTypeId')
    if (!date || !shiftTypeId) throw new HttpError(400, 'ต้องระบุ date และ shiftTypeId')
    const ctx = await loadScheduleContext(id)
    const candidates = await getCandidates(ctx, date, shiftTypeId)
    return { candidates }
  })
}
