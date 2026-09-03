import { z } from 'zod'
import { requireAdmin } from '@/lib/server/auth'
import { deleteLineGroupMapping, saveLineGroupMapping } from '@/lib/server/line-group-mapping'
import { readJson, respond } from '@/lib/server/route'

const lineGroupId = z.string().trim().min(1, 'กรุณาระบุ LINE Group ID').max(120, 'LINE Group ID ยาวเกินไป').regex(/^[A-Za-z0-9_-]+$/, 'LINE Group ID ต้องเป็นตัวอักษร ตัวเลข หรือ - _ เท่านั้น')
const updateSchema = z.object({
  teamId: z.string().uuid(),
  shiftTypeId: z.string().uuid().nullable().optional(),
  lineGroupId,
  isActive: z.boolean().optional(),
}).strict()

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireAdmin()
    const body = await readJson(request, updateSchema)
    const mapping = await saveLineGroupMapping(actor.id, { ...body, id: (await params).id })
    return { mapping }
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireAdmin()
    await deleteLineGroupMapping(actor.id, (await params).id)
    return { ok: true }
  })
}

