import { z } from 'zod'
import { bangkokMonthNow } from '@/lib/dates'
import { ATTENDANCE_CODES, type AttendanceCode } from '@/lib/types'
import { isIsoDate, isIsoMonth } from '@/lib/attendance'
import { assertAttendanceDatesOpen, canManageAttendance, getAttendanceGrid, getAttendanceHistory } from '@/lib/server/attendance'
import { requireActor, requireAttendanceRecorder } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

const scopeSchema = z.enum(['all', 'mine'])

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const url = new URL(request.url)
    const scope = scopeSchema.parse(url.searchParams.get('scope') ?? 'all')
    const canManage = await canManageAttendance(actor)

    if (scope === 'all') {
      const month = url.searchParams.get('month') ?? bangkokMonthNow()
      if (!isIsoMonth(month)) throw new HttpError(400, 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)')
      const grid = await getAttendanceGrid(month)
      return {
        scope,
        canManage,
        canManageHolidays: actor.isScheduler,
        me: actor.id,
        ...grid,
        availablePeople: canManage ? grid.availablePeople : [],
      }
    }

    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (from && !isIsoDate(from)) throw new HttpError(400, 'from ต้องเป็นวันที่รูปแบบ YYYY-MM-DD')
    if (to && !isIsoDate(to)) throw new HttpError(400, 'to ต้องเป็นวันที่รูปแบบ YYYY-MM-DD')
    if (from && to && from > to) throw new HttpError(400, 'ช่วงวันที่ไม่ถูกต้อง')
    const cursor = url.searchParams.get('cursor')
    const rawLimit = Number(url.searchParams.get('limit') ?? 50)
    const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50
    const history = await getAttendanceHistory(actor.id, from, to, cursor, limit)
    return { scope, canManage, me: actor.id, from, to, ...history }
  })
}

const createSchema = z.object({
  userId: z.string().uuid(),
  code: z.enum(ATTENDANCE_CODES),
  dates: z.array(z.string()).min(1).max(366),
  note: z.string().trim().max(500).optional(),
})

function validateDates(dates: string[]) {
  const unique = [...new Set(dates)]
  if (unique.length !== dates.length) throw new HttpError(400, 'ไม่ควรมีวันที่ซ้ำกันในรายการเดียว')
  if (dates.some((date) => !isIsoDate(date))) throw new HttpError(400, 'วันที่ต้องเป็นรูปแบบ YYYY-MM-DD และเป็นวันที่จริง')
  return [...dates].sort()
}

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireAttendanceRecorder()
    const body = await readJson(request, createSchema)
    const dates = validateDates(body.dates)
    await assertAttendanceDatesOpen(dates)
    const admin = getAdminClient()

    const { data: person, error: personError } = await admin
      .from('profiles')
      .select('id,status,deleted_at')
      .eq('id', body.userId)
      .maybeSingle()
    if (personError) throw new HttpError(500, personError.message)
    if (!person) throw new HttpError(404, 'ไม่พบบุคลากรที่เลือก')
    if (String(person.status ?? 'active').toLowerCase() !== 'active' || person.deleted_at) {
      throw new HttpError(400, 'ไม่สามารถบันทึกข้อมูลให้บุคลากรที่ไม่ active ได้')
    }

    const { data: rosterEntry, error: rosterError } = await admin
      .from('shift_leave_roster')
      .select('user_id')
      .eq('user_id', body.userId)
      .is('removed_at', null)
      .maybeSingle()
    if (rosterError) throw new HttpError(500, rosterError.message)
    if (!rosterEntry) throw new HttpError(400, 'กรุณาเพิ่มบุคลากรเข้าทะเบียนก่อนบันทึกรายการ')

    const { data: existing, error: existingError } = await admin
      .from('shift_attendance_records')
      .select('record_date')
      .eq('user_id', body.userId)
      .eq('code', body.code)
      .in('record_date', dates)
      .is('deleted_at', null)
    if (existingError) throw new HttpError(500, existingError.message)
    const conflicts = (existing ?? []).map((row) => String(row.record_date)).sort()
    if (conflicts.length > 0) {
      throw new HttpError(409, `มีรายการ ${body.code} อยู่แล้วในวันที่ ${conflicts.join(', ')}`)
    }

    const now = new Date().toISOString()
    const rows = dates.map((recordDate) => ({
      user_id: body.userId,
      record_date: recordDate,
      code: body.code as AttendanceCode,
      note: body.note || null,
      source: 'manual' as const,
      source_ref: null,
      created_by: actor.id,
      updated_by: actor.id,
      updated_at: now,
    }))
    const { data, error } = await admin
      .from('shift_attendance_records')
      .insert(rows)
      .select('*')
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'มีรหัสนี้ในวันเดียวกันอยู่แล้ว')
      throw new HttpError(500, error.message)
    }
    return { records: data ?? [] }
  })
}
