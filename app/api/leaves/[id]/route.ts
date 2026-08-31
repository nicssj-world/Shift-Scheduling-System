import { z } from 'zod'
import { ATTENDANCE_CODES } from '@/lib/types'
import { isIsoDate } from '@/lib/attendance'
import { requireAttendanceRecorder } from '@/lib/server/auth'
import { assertAttendanceDatesOpen } from '@/lib/server/attendance'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

const editSchema = z.object({
  recordDate: z.string().optional(),
  code: z.enum(ATTENDANCE_CODES).optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).refine((body) => Object.keys(body).length > 0, { message: 'ต้องระบุข้อมูลที่ต้องการแก้ไข' })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireAttendanceRecorder()
    const { id } = await params
    const body = await readJson(request, editSchema)
    if (body.recordDate && !isIsoDate(body.recordDate)) {
      throw new HttpError(400, 'วันที่ต้องเป็นรูปแบบ YYYY-MM-DD และเป็นวันที่จริง')
    }

    const admin = getAdminClient()
    const { data: existing, error: existingError } = await admin
      .from('shift_attendance_records')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (existingError) throw new HttpError(500, existingError.message)
    const current = existing as Record<string, unknown> | null
    if (!current) throw new HttpError(404, 'ไม่พบรายการทะเบียน')

    const nextDate = body.recordDate ?? String(current.record_date)
    const nextCode = body.code ?? String(current.code)
    await assertAttendanceDatesOpen([nextDate])
    if (body.recordDate || body.code) {
      const { data: duplicate, error: duplicateError } = await admin
        .from('shift_attendance_records')
        .select('id')
        .eq('user_id', String(current.user_id))
        .eq('record_date', nextDate)
        .eq('code', nextCode)
        .neq('id', id)
        .is('deleted_at', null)
        .maybeSingle()
      if (duplicateError) throw new HttpError(500, duplicateError.message)
      if (duplicate) throw new HttpError(409, 'มีรหัสเดียวกันของบุคลากรคนนี้ในวันดังกล่าวแล้ว')
    }

    const now = new Date().toISOString()
    const update: Record<string, unknown> = {
      updated_by: actor.id,
      updated_at: now,
    }
    if (body.recordDate) update.record_date = body.recordDate
    if (body.code) update.code = body.code
    if (body.note !== undefined) update.note = body.note || null
    const { data, error } = await admin
      .from('shift_attendance_records')
      .update(update)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'มีรายการซ้ำในวันเดียวกัน')
      throw new HttpError(500, error.message)
    }
    return { record: data }
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireAttendanceRecorder()
    const { id } = await params
    const admin = getAdminClient()
    const now = new Date().toISOString()
    const { data, error } = await admin
      .from('shift_attendance_records')
      .update({ deleted_by: actor.id, deleted_at: now, updated_by: actor.id, updated_at: now })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()
    if (error) throw new HttpError(500, error.message)
    if (!data) throw new HttpError(404, 'ไม่พบรายการทะเบียน หรือรายการนี้ถูกลบแล้ว')
    return { ok: true, id }
  })
}
