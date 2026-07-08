import { z } from 'zod'
import { requireScheduler } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { readJson, respond } from '@/lib/server/route'
import { assertEditable, loadScheduleContext, validateSchedule } from '@/lib/server/schedule-service'
import { getAdminClient } from '@/lib/supabase/admin'
import { thaiShortDate } from '@/lib/dates'

const setSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftTypeId: z.string().uuid(),
  userId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  /** when replacing a person in an existing cell */
  replaceAssignmentId: z.string().uuid().optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireScheduler()
    const { id } = await params
    const body = await readJson(request, setSchema)
    const ctx = await loadScheduleContext(id)
    assertEditable(ctx.schedule)

    const admin = getAdminClient()
    const changedUsers: string[] = [body.userId]

    if (body.replaceAssignmentId) {
      const { data: old } = await admin.from('shift_assignments')
        .select('user_id').eq('id', body.replaceAssignmentId).maybeSingle()
      if (old) changedUsers.push(String(old.user_id))
      const { error } = await admin.from('shift_assignments')
        .update({ user_id: body.userId, source: 'manual' })
        .eq('id', body.replaceAssignmentId)
      if (error) throw new HttpError(409, 'คนนี้มีเวรนี้อยู่แล้ว')
    } else {
      const { error } = await admin.from('shift_assignments').insert({
        schedule_id: id,
        work_date: body.workDate,
        shift_type_id: body.shiftTypeId,
        user_id: body.userId,
        job_id: body.jobId ?? null,
        source: 'manual',
      })
      if (error) throw new HttpError(409, error.message.includes('duplicate') ? 'คนนี้มีเวรนี้อยู่แล้ว' : error.message)
    }

    if (ctx.schedule.status === 'published') {
      const shiftType = ctx.shiftTypes.find((t) => t.id === body.shiftTypeId)
      await notifyUsers(changedUsers, {
        type: 'schedule_changed',
        title: `มีการเปลี่ยนแปลงตารางเวรวันที่ ${thaiShortDate(body.workDate)}`,
        body: shiftType ? `${shiftType.name_th} (${shiftType.code})` : undefined,
        link: `/schedule?team=${ctx.teamId}&month=${ctx.month}`,
      })
    }

    const violations = await validateSchedule(ctx)
    return { ok: true, violations }
  })
}

const removeSchema = z.object({ assignmentId: z.string().uuid() })

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireScheduler()
    const { id } = await params
    const body = await readJson(request, removeSchema)
    const ctx = await loadScheduleContext(id)
    assertEditable(ctx.schedule)

    const admin = getAdminClient()
    const { data: old } = await admin.from('shift_assignments')
      .select('user_id,work_date').eq('id', body.assignmentId).maybeSingle()
    const { error } = await admin.from('shift_assignments')
      .delete().eq('id', body.assignmentId).eq('schedule_id', id)
    if (error) throw new HttpError(500, error.message)

    if (old && ctx.schedule.status === 'published') {
      await notifyUsers([String(old.user_id)], {
        type: 'schedule_changed',
        title: `เวรของคุณวันที่ ${thaiShortDate(String(old.work_date))} ถูกยกเลิก`,
        link: `/schedule?team=${ctx.teamId}&month=${ctx.month}`,
      })
    }

    const violations = await validateSchedule(ctx)
    return { ok: true, violations }
  })
}

const jobSchema = z.object({
  assignmentId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireScheduler()
    const { id } = await params
    const body = await readJson(request, jobSchema)
    const ctx = await loadScheduleContext(id)
    assertEditable(ctx.schedule)
    const admin = getAdminClient()
    const { error } = await admin.from('shift_assignments')
      .update({ job_id: body.jobId, source: 'manual' })
      .eq('id', body.assignmentId).eq('schedule_id', id)
    if (error) throw new HttpError(500, error.message)
    const violations = await validateSchedule(ctx)
    return { ok: true, violations }
  })
}
