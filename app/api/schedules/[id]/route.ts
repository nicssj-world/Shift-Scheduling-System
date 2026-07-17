import { z } from 'zod'
import { requireScheduler } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { readJson, respond } from '@/lib/server/route'
import { getSchedule, getTeam, getTeamMembers } from '@/lib/server/data'
import { loadScheduleContext, validateSchedule } from '@/lib/server/schedule-service'
import { getAdminClient } from '@/lib/supabase/admin'
import { thaiMonthLabel } from '@/lib/dates'

const actionSchema = z.object({
  action: z.enum(['publish', 'unpublish', 'lock', 'unlock']),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireScheduler()
    const { id } = await params
    const { action } = await readJson(request, actionSchema)
    const schedule = await getSchedule(id)
    const admin = getAdminClient()
    const month = String(schedule.month).slice(0, 7)
    const now = new Date().toISOString()

    if (action === 'publish') {
      if (schedule.status === 'locked') throw new HttpError(409, 'ตารางถูกล็อคแล้ว')
      const ctx = await loadScheduleContext(id)
      const hardErrors = (await validateSchedule(ctx)).filter((violation) => violation.severity === 'error')
      if (hardErrors.length > 0) {
        throw new HttpError(
          409,
          `ยังเผยแพร่ไม่ได้: ตารางมีข้อผิดพลาด ${hardErrors.length} จุด กรุณาแก้ไขหรือสร้างตารางอัตโนมัติใหม่ก่อน`,
        )
      }
      const { error } = await admin.from('shift_schedules')
        .update({ status: 'published', published_at: now, published_by: actor.id }).eq('id', id)
      if (error) throw new HttpError(500, error.message)
      const [team, members] = await Promise.all([getTeam(schedule.team_id), getTeamMembers(schedule.team_id)])
      await notifyUsers(members.map((m) => m.user_id), {
        type: 'schedule_published',
        title: `เผยแพร่ตารางเวร${team.name_th} เดือน${thaiMonthLabel(month)}`,
        body: 'ตรวจสอบเวรของคุณได้ที่หน้าตารางเวร',
        link: `/schedule?team=${schedule.team_id}&month=${month}`,
      })
    } else if (action === 'unpublish') {
      if (schedule.status === 'locked') throw new HttpError(409, 'ต้องปลดล็อคก่อน')
      const { error } = await admin.from('shift_schedules')
        .update({ status: 'draft' }).eq('id', id)
      if (error) throw new HttpError(500, error.message)
    } else if (action === 'lock') {
      if (schedule.status === 'draft') throw new HttpError(409, 'ต้องเผยแพร่ก่อนจึงจะล็อคได้')
      const ctx = await loadScheduleContext(id)
      const hardErrors = (await validateSchedule(ctx)).filter((violation) => violation.severity === 'error')
      if (hardErrors.length > 0) {
        throw new HttpError(409, `ยังล็อคไม่ได้: ตารางมีข้อผิดพลาด ${hardErrors.length} จุด`)
      }
      const { error } = await admin.from('shift_schedules')
        .update({ status: 'locked', locked_at: now, locked_by: actor.id }).eq('id', id)
      if (error) throw new HttpError(500, error.message)
    } else if (action === 'unlock') {
      if (!actor.isAdmin) throw new HttpError(403, 'เฉพาะ Admin เท่านั้นที่ปลดล็อคได้')
      const { error } = await admin.from('shift_schedules')
        .update({ status: 'published', locked_at: null, locked_by: null }).eq('id', id)
      if (error) throw new HttpError(500, error.message)
    }

    const updated = await getSchedule(id)
    return { schedule: updated }
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    await requireScheduler()
    const { id } = await params
    const schedule = await getSchedule(id)
    if (schedule.status !== 'draft') throw new HttpError(409, 'ลบได้เฉพาะตารางฉบับร่าง')
    const admin = getAdminClient()
    const { error } = await admin.from('shift_schedules').delete().eq('id', id)
    if (error) throw new HttpError(500, error.message)
    return { ok: true }
  })
}
