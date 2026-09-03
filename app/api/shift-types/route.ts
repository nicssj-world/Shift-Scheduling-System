import { z } from 'zod'
import { requireActor, requireScheduler } from '@/lib/server/auth'
import { getShiftTypes } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeShiftTimes } from '@/lib/scheduler/shift-time'

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
  triggersRestAfterNight: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0284c7'),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

export async function POST(request: Request) {
  return respond(async () => {
    await requireScheduler()
    const body = await readJson(request, upsertSchema)
    const admin = getAdminClient()
    let normalized: ReturnType<typeof normalizeShiftTimes>
    try {
      normalized = normalizeShiftTimes(body.startTime, body.endTime, body.hours)
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'เวลาเวรไม่ถูกต้อง')
    }
    const row = {
      code: body.code,
      name_th: body.nameTh,
      start_time: clockString(normalized.startMin),
      end_time: clockString(normalized.endMin),
      hours: normalized.hours,
      triggers_rest_after_night: body.triggersRestAfterNight ?? body.code.toUpperCase() === 'N',
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

function clockString(minutes: number) {
  if (minutes === 1440) return '24:00:00'
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`
}
