import { z } from 'zod'
import { getLineSettings } from '@/lib/server/line-config'
import { transitionSwap } from '@/lib/server/line-mutations'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { readJson, respond } from '@/lib/server/route'
import { HttpError } from '@/lib/server/errors'
import { writeLineAudit } from '@/lib/server/line-audit'

const schema = z.object({ action: z.enum(['accept', 'decline', 'approve', 'reject', 'cancel']) })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireLineSessionActor(request, true)
    const settings = await getLineSettings()
    if (!settings.enabled || !settings.swapEnabled) throw new HttpError(403, 'การแลกเวรผ่าน LINE ยังไม่เปิดใช้งาน')
    const { action } = await readJson(request, schema)
    const id = (await params).id
    const swap = await transitionSwap(actor, id, action)
    await writeLineAudit({ actorUserId: actor.id, source: 'line', action: `swap_${action}`, referenceType: 'shift_swap_request', referenceId: id })
    return { swap }
  })
}
