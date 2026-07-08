import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { thaiShortDate } from '@/lib/dates'
import { LEAVE_TYPE_TH } from '@/lib/types'

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const url = new URL(request.url)
    const scope = url.searchParams.get('scope') ?? 'mine'
    const from = url.searchParams.get('from') // YYYY-MM-DD
    const to = url.searchParams.get('to')
    const admin = getAdminClient()

    let query = admin.from('shift_leaves').select('*').order('start_date', { ascending: false }).limit(500)
    if (scope === 'all') {
      if (!actor.isAdmin && !actor.isManager && !actor.isScheduler) throw new HttpError(403, 'ไม่มีสิทธิ์ดูวันลาทุกคน')
    } else {
      query = query.eq('user_id', actor.id)
    }
    if (from) query = query.gte('end_date', from)
    if (to) query = query.lte('start_date', to)
    const { data, error } = await query
    if (error) throw new HttpError(500, error.message)
    const rows = (data ?? []) as Record<string, unknown>[]

    const userIds = [...new Set(rows.map((r) => String(r.user_id)))]
    let names: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: profiles } = await admin.from('profiles').select('id,name,dept').in('id', userIds)
      names = Object.fromEntries((profiles ?? []).map((p) => [String(p.id), String(p.name)]))
    }
    return { leaves: rows.map((r) => ({ ...r, userName: names[String(r.user_id)] ?? '' })), me: actor.id }
  })
}

const createSchema = z.object({
  userId: z.string().uuid().optional(),
  leaveType: z.enum(['vacation', 'sick', 'personal', 'other']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayPart: z.enum(['full', 'half_am', 'half_pm']).default('full'),
  note: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const body = await readJson(request, createSchema)
    if (body.endDate < body.startDate) throw new HttpError(400, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
    if (body.dayPart !== 'full' && body.startDate !== body.endDate) {
      throw new HttpError(400, 'ลาครึ่งวันต้องเป็นวันเดียว')
    }

    const isManagerEntry = Boolean(body.userId) && body.userId !== actor.id
    if (isManagerEntry && !actor.isAdmin && !actor.isManager) {
      throw new HttpError(403, 'เฉพาะ Admin/Manager คีย์วันลาให้คนอื่นได้')
    }
    const targetUserId = body.userId ?? actor.id
    // Admin/Manager entries are approved immediately (their own or others')
    const autoApproved = actor.isAdmin || actor.isManager

    const admin = getAdminClient()
    const { data, error } = await admin.from('shift_leaves').insert({
      user_id: targetUserId,
      leave_type: body.leaveType,
      start_date: body.startDate,
      end_date: body.endDate,
      day_part: body.dayPart,
      note: body.note ?? null,
      status: autoApproved ? 'approved' : 'pending',
      requested_by: actor.id,
      decided_by: autoApproved ? actor.id : null,
      decided_at: autoApproved ? new Date().toISOString() : null,
    }).select('*').single()
    if (error) throw new HttpError(500, error.message)

    const range = body.startDate === body.endDate
      ? thaiShortDate(body.startDate)
      : `${thaiShortDate(body.startDate)} – ${thaiShortDate(body.endDate)}`

    if (!autoApproved) {
      // notify approvers
      const { data: managers } = await admin.from('profiles').select('id,role')
        .or('role.eq.Admin,role.eq.Manager,role.eq.admin,role.eq.staff')
      await notifyUsers((managers ?? []).map((m) => String(m.id)), {
        type: 'leave_requested',
        title: `${actor.name} แจ้ง${LEAVE_TYPE_TH[body.leaveType]} ${range}`,
        link: '/leaves',
      })
    } else if (targetUserId !== actor.id) {
      await notifyUsers([targetUserId], {
        type: 'leave_recorded',
        title: `บันทึก${LEAVE_TYPE_TH[body.leaveType]}ให้คุณ ${range}`,
        link: '/leaves',
      })
    }
    return { leave: data }
  })
}
