import { z } from 'zod'
import { getLineSettings } from '@/lib/server/line-config'
import { createSwapRequest, mutationId } from '@/lib/server/line-mutations'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { readJson, respond } from '@/lib/server/route'
import { HttpError } from '@/lib/server/errors'
import { writeLineAudit } from '@/lib/server/line-audit'

const schema = z.object({
  requesterAssignmentId: z.string().uuid(),
  targetAssignmentId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireLineSessionActor(request, true)
    const settings = await getLineSettings()
    if (!settings.enabled || !settings.swapEnabled) throw new HttpError(403, 'การแลกเวรผ่าน LINE ยังไม่เปิดใช้งาน')
    const result = await createSwapRequest(actor, await readJson(request, schema))
    await writeLineAudit({ actorUserId: actor.id, source: 'line', action: 'swap_created', referenceType: 'shift_swap_request', referenceId: mutationId(result.swap) })
    return result
  })
}
