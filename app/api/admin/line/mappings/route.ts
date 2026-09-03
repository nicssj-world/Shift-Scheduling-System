import { z } from 'zod'
import { requireAdmin } from '@/lib/server/auth'
import { getLineGroupMappingAdminData, saveLineGroupMapping } from '@/lib/server/line-group-mapping'
import { readJson, respond } from '@/lib/server/route'

const lineGroupId = z.string().trim().min(1, 'กรุณาระบุ LINE Group ID').max(120, 'LINE Group ID ยาวเกินไป').regex(/^[A-Za-z0-9_-]+$/, 'LINE Group ID ต้องเป็นตัวอักษร ตัวเลข หรือ - _ เท่านั้น')
const createSchema = z.object({
  teamId: z.string().uuid(),
  shiftTypeId: z.string().uuid().nullable().optional(),
  lineGroupId,
  isActive: z.boolean().optional(),
}).strict()

export async function GET() {
  return respond(async () => {
    await requireAdmin()
    return getLineGroupMappingAdminData()
  })
}

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireAdmin()
    const body = await readJson(request, createSchema)
    const mapping = await saveLineGroupMapping(actor.id, body)
    return { mapping }
  })
}

