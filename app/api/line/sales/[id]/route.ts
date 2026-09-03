import { z } from 'zod'
import { getLineSettings } from '@/lib/server/line-config'
import { transitionSale } from '@/lib/server/line-mutations'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { readJson, respond } from '@/lib/server/route'
import { HttpError } from '@/lib/server/errors'
import { writeLineAudit } from '@/lib/server/line-audit'
import { getSaleSettings } from '@/lib/server/data'

const schema = z.object({ action: z.enum(['claim', 'accept', 'decline', 'approve', 'reject', 'cancel']) })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireLineSessionActor(request, true)
    const settings = await getLineSettings()
    const saleSettings = await getSaleSettings()
    if (!settings.enabled || !settings.saleEnabled) throw new HttpError(403, 'การขายเวรผ่าน LINE ยังไม่เปิดใช้งาน')
    const { action } = await readJson(request, schema)
    if (action === 'claim' && !settings.openSaleEnabled) throw new HttpError(403, 'การประกาศขายเวรผ่าน LINE ยังไม่เปิดใช้งาน')
    if (action === 'claim' && !saleSettings.openEnabled) throw new HttpError(403, 'ระบบยังไม่เปิดตลาดเวรเปิดขาย')
    const id = (await params).id
    const sale = await transitionSale(actor, id, action, 'line')
    await writeLineAudit({ actorUserId: actor.id, source: 'line', action: `sale_${action}`, referenceType: 'shift_sale_request', referenceId: id })
    return { sale }
  })
}
