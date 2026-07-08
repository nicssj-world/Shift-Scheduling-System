import { z } from 'zod'
import { requireActor, requireManager } from '@/lib/server/auth'
import { getShiftTypes } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  return respond(async () => {
    await requireActor()
    return { shiftTypes: await getShiftTypes() }
  })
}

const TIME_RE = /^([01]\d|2[0-3]|24):[0-5]\d$/

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1).max(8),
  nameTh: z.string().min(1).max(60),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  hours: z.number().positive().max(24),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0284c7'),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

export async function POST(request: Request) {
  return respond(async () => {
    await requireManager()
    const body = await readJson(request, upsertSchema)
    const admin = getAdminClient()
    const row = {
      code: body.code,
      name_th: body.nameTh,
      start_time: body.startTime === '24:00' ? '00:00' : body.startTime,
      end_time: body.endTime === '24:00' ? '24:00:00' : body.endTime,
      hours: body.hours,
      color: body.color,
      is_active: body.isActive,
      sort_order: body.sortOrder,
    }
    if (body.id) {
      const { error } = await admin.from('shift_shift_types').update(row).eq('id', body.id)
      if (error) throw new HttpError(500, error.message)
    } else {
      const { error } = await admin.from('shift_shift_types').insert(row)
      if (error) throw new HttpError(500, error.message)
    }
    return { shiftTypes: await getShiftTypes() }
  })
}
