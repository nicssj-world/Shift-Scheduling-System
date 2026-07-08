import { requireActor } from '@/lib/server/auth'
import { bangkokDateString } from '@/lib/dates'
import { getShiftTypes, getTeamMembers, getTeams } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

/** Options for the create-sale modal: my future shifts (to sell) + eligible buyers per team. */
export async function GET() {
  return respond(async () => {
    const actor = await requireActor()
    const admin = getAdminClient()
    const today = bangkokDateString()

    const { data: schedules, error } = await admin
      .from('shift_schedules').select('id,team_id,status').eq('status', 'published')
    if (error) throw new HttpError(500, error.message)
    const scheduleIds = (schedules ?? []).map((s) => String(s.id))
    if (scheduleIds.length === 0) return { mine: [], members: [] }
    const teamByScheduleId = new Map((schedules ?? []).map((s) => [String(s.id), String(s.team_id)]))

    const { data: myAssignments } = await admin
      .from('shift_assignments')
      .select('id,schedule_id,work_date,shift_type_id')
      .eq('user_id', actor.id)
      .gte('work_date', today)
      .in('schedule_id', scheduleIds)
      .order('work_date')

    const shiftTypes = await getShiftTypes()
    const typeById = new Map(shiftTypes.map((t) => [t.id, t]))

    const myTeamIds = [...new Set(
      (myAssignments ?? []).map((a) => teamByScheduleId.get(String(a.schedule_id))).filter((t): t is string => Boolean(t)),
    )]
    const teams = await getTeams()
    const validTeamIds = new Set(teams.map((t) => t.id))
    const members: { userId: string; userName: string; teamId: string }[] = []
    for (const teamId of myTeamIds) {
      if (!validTeamIds.has(teamId)) continue
      const teamMembers = await getTeamMembers(teamId)
      for (const m of teamMembers) {
        if (m.user_id !== actor.id) members.push({ userId: m.user_id, userName: m.displayName, teamId })
      }
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

    return { mine: (myAssignments ?? []).map(describe), members }
  })
}
