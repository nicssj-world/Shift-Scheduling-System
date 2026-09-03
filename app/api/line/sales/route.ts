import { z } from 'zod'
import { getLineSettings } from '@/lib/server/line-config'
import { createDirectSaleRequest, createOpenSaleRequest, mutationId } from '@/lib/server/line-mutations'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { readJson, respond } from '@/lib/server/route'
import { HttpError } from '@/lib/server/errors'
import { writeLineAudit } from '@/lib/server/line-audit'

const schema = z.object({
  mode: z.enum(['direct', 'open']).default('direct'),
  assignmentIds: z.array(z.string().uuid()).min(1).max(31)
    .refine((ids) => new Set(ids).size === ids.length, 'มีรายการเวรซ้ำกัน'),
  buyerId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireLineSessionActor(request, true)
    const settings = await getLineSettings()
    if (!settings.enabled || !settings.saleEnabled) throw new HttpError(403, 'การขายเวรผ่าน LINE ยังไม่เปิดใช้งาน')
    const body = await readJson(request, schema)
    if (body.mode === 'open') {
      if (!settings.openSaleEnabled) throw new HttpError(403, 'การประกาศขายเวรยังไม่เปิดใช้งาน')
      const result = await createOpenSaleRequest(actor, body)
      await writeLineAudit({ actorUserId: actor.id, source: 'line', action: 'sale_opened', referenceType: 'shift_sale_request', referenceId: mutationId(result.sale) })
      return result
    }
    if (!body.buyerId) throw new HttpError(400, 'กรุณาเลือกผู้ซื้อ')
    const result = await createDirectSaleRequest(actor, { assignmentIds: body.assignmentIds, buyerId: body.buyerId, reason: body.reason })
    await writeLineAudit({ actorUserId: actor.id, source: 'line', action: 'sale_created', referenceType: 'shift_sale_request', referenceId: mutationId(result.sale) })
    return result
  })
}
