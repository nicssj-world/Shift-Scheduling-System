import { requireActor } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'
import { getAssignments, getShiftTypes, getTeamMembers, getTeams } from '@/lib/server/data'
import { getAdminClient } from '@/lib/supabase/admin'

/** OT summary: per person, count and hours per shift type for a month. */
export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const url = new URL(request.url)
    const month = url.searchParams.get('month')
    const teamId = url.searchParams.get('team')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'ต้องระบุ month (YYYY-MM)')

    const teams = (await getTeams()).filter((t) => t.is_active && (!teamId || t.id === teamId))
    const shiftTypes = await getShiftTypes()
    const typeById = new Map(shiftTypes.map((t) => [t.id, t]))
    const admin = getAdminClient()

    const rows: Record<string, {
      userId: string; name: string; team: string
      byType: Record<string, number>; totalShifts: number; totalHours: number
    }> = {}

    for (const team of teams) {
      const members = await getTeamMembers(team.id)
      const nameByUser = new Map(members.map((m) => [m.user_id, m.profile.name]))
      const { data: schedule } = await admin
        .from('shift_schedules').select('id')
        .eq('team_id', team.id).eq('month', `${month}-01`).maybeSingle()
      if (!schedule) continue
      const assignments = await getAssignments(String(schedule.id))
      for (const a of assignments) {
        const userId = String(a.user_id)
        if (!actor.isScheduler && userId !== actor.id) continue
        const type = typeById.get(String(a.shift_type_id))
        if (!type) continue
        const row = (rows[userId] ??= {
          userId, name: nameByUser.get(userId) ?? '', team: team.name_th,
          byType: {}, totalShifts: 0, totalHours: 0,
        })
        row.byType[type.code] = (row.byType[type.code] ?? 0) + 1
        row.totalShifts += 1
        row.totalHours += Number(type.hours)
      }
    }

    return {
      month,
      shiftTypes: shiftTypes.map((t) => ({ code: t.code, name: t.name_th, hours: Number(t.hours) })),
      rows: Object.values(rows).sort((a, b) => b.totalHours - a.totalHours),
    }
  })
}
