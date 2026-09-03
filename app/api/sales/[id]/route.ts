import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { readJson, respond } from '@/lib/server/route'
import { transitionSale } from '@/lib/server/line-mutations'

const actionSchema = z.object({
  action: z.enum(['accept', 'decline', 'approve', 'reject', 'cancel', 'claim']),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireActor()
    const { id } = await params
    const { action } = await readJson(request, actionSchema)
    const updated = await transitionSale(actor, id, action)
    return { sale: updated }
  })
}
