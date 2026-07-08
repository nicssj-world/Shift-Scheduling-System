import { requireActor } from '@/lib/server/auth'
import { bangkokDateString } from '@/lib/dates'
import { getShiftTypes, getTeamMembers, getTeams } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

/** Options for the create-swap modal: my future shifts + possible counterpart shifts. */
export async function GET() {
  return respond(async () => {
    const actor = await requireActor()
    const admin = getAdminClient()
    const today = bangkokDateString()

    const { data: schedules, error } = await admin
      .from('shift_schedules').select('id,team_id,status').eq('status', 'published')
    if (error) throw new HttpError(500, error.message)
    const scheduleIds = (schedules ?? []).map((s) => String(s.id))
    if (scheduleIds.length === 0) return { mine: [], others: [] }
    const teamByScheduleId = new Map((schedules ?? []).map((s) => [String(s.id), String(s.team_id)]))

    const { data: myAssignments } = await admin
      .from('shift_assignments')
      .select('id,schedule_id,work_date,shift_type_id')
      .eq('user_id', actor.id)
      .gte('work_date', today)
      .in('schedule_id', scheduleIds)
      .order('work_date')

    const mySchedules = [...new Set((myAssignments ?? []).map((a) => String(a.schedule_id)))]
    if (mySchedules.length === 0) return { mine: [], others: [] }

    const { data: allAssignments } = await admin
      .from('shift_assignments')
      .select('id,schedule_id,work_date,shift_type_id,user_id')
      .in('schedule_id', mySchedules)
      .gte('work_date', today)
      .neq('user_id', actor.id)
      .order('work_date')

    const shiftTypes = await getShiftTypes()
    const typeById = new Map(shiftTypes.map((t) => [t.id, t]))

    // display names per team
    const teams = await getTeams()
    const nameByUser = new Map<string, string>()
    for (const team of teams) {
      const members = await getTeamMembers(team.id)
      for (const m of members) nameByUser.set(m.user_id, m.displayName)
    }

    const describe = (a: { id: unknown; schedule_id: unknown; work_date: unknown; shift_type_id: unknown }) => {
      const type = typeById.get(String(a.shift_type_id))
      return {
        id: String(a.id),
        scheduleId: String(a.schedule_id),
        teamId: teamByScheduleId.get(String(a.schedule_id)) ?? '',
        date: String(a.work_date),
        code: type?.code ?? '?',
        typeName: type?.name_th ?? '?',
      }
    }

    return {
      mine: (myAssignments ?? []).map(describe),
      others: (allAssignments ?? []).map((a) => ({
        ...describe(a),
        userId: String(a.user_id),
        userName: nameByUser.get(String(a.user_id)) ?? 'ไม่ทราบชื่อ',
      })),
    }
  })
}
