import { requireActor } from '@/lib/server/auth'
import { bangkokDateString } from '@/lib/dates'
import { getShiftTypes, getTeamMembersForTeams } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { parseOptionMonth } from '@/lib/server/pagination'
import { getPendingAssignmentIds } from '@/lib/server/request-conflicts'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

/** Options for the create-swap modal: my future shifts + possible counterpart shifts. */
export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const admin = getAdminClient()
    const today = bangkokDateString()
    const month = parseOptionMonth(new URL(request.url))

    const { data: schedules, error } = await admin
      .from('shift_schedules').select('id,team_id,status')
      .eq('status', 'published').eq('month', `${month}-01`)
    if (error) throw new HttpError(500, error.message)
    const scheduleIds = (schedules ?? []).map((s) => String(s.id))
    if (scheduleIds.length === 0) return { mine: [], others: [] }
    const teamByScheduleId = new Map((schedules ?? []).map((s) => [String(s.id), String(s.team_id)]))

    const [myAssignmentsResult, shiftTypes] = await Promise.all([
      admin.from('shift_assignments')
        .select('id,schedule_id,work_date,shift_type_id')
        .eq('user_id', actor.id)
        .gte('work_date', today)
        .in('schedule_id', scheduleIds)
        .order('work_date'),
      getShiftTypes(),
    ])
    if (myAssignmentsResult.error) throw new HttpError(500, myAssignmentsResult.error.message)
    const myAssignments = myAssignmentsResult.data ?? []

    const mySchedules = [...new Set(myAssignments.map((a) => String(a.schedule_id)))]
    if (mySchedules.length === 0) return { mine: [], others: [] }
    const relevantTeamIds = [...new Set(
      mySchedules.map((scheduleId) => teamByScheduleId.get(scheduleId)).filter((teamId): teamId is string => Boolean(teamId)),
    )]
    // Start the two-step members+profiles batch while assignments load.
    const membersPromise = getTeamMembersForTeams(relevantTeamIds)

    const { data: allAssignments, error: assignmentsError } = await admin
      .from('shift_assignments')
      .select('id,schedule_id,work_date,shift_type_id,user_id')
      .in('schedule_id', mySchedules)
      .gte('work_date', today)
      .neq('user_id', actor.id)
      .order('work_date')
    if (assignmentsError) throw new HttpError(500, assignmentsError.message)

    const [blockedIds, members] = await Promise.all([
      getPendingAssignmentIds([
        ...myAssignments.map((assignment) => String(assignment.id)),
        ...(allAssignments ?? []).map((assignment) => String(assignment.id)),
      ]),
      membersPromise,
    ])
    const typeById = new Map(shiftTypes.map((t) => [t.id, t]))

    const nameByTeamAndUser = new Map(
      members.map((member) => [`${member.team_id}|${member.user_id}`, member.displayName]),
    )

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
      mine: myAssignments.filter((assignment) => !blockedIds.has(String(assignment.id))).map(describe),
      others: (allAssignments ?? []).filter((assignment) => !blockedIds.has(String(assignment.id))).map((a) => ({
        ...describe(a),
        userId: String(a.user_id),
        userName: nameByTeamAndUser.get(`${teamByScheduleId.get(String(a.schedule_id))}|${String(a.user_id)}`) ?? 'ไม่ทราบชื่อ',
      })),
    }
  })
}
