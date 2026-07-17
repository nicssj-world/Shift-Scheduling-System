import { requireActor } from '@/lib/server/auth'
import { bangkokDateString } from '@/lib/dates'
import { getShiftTypes, getTeamMembersForTeams } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { parseOptionMonth } from '@/lib/server/pagination'
import { getPendingAssignmentIds } from '@/lib/server/request-conflicts'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

/** Options for the create-sale modal: all my shifts in the selected month.
 * Past or reserved shifts stay visible with a reason, but cannot be sold. */
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
    if (scheduleIds.length === 0) return { mine: [], members: [] }
    const teamByScheduleId = new Map((schedules ?? []).map((s) => [String(s.id), String(s.team_id)]))

    const [myAssignmentsResult, shiftTypes] = await Promise.all([
      admin.from('shift_assignments')
        .select('id,schedule_id,work_date,shift_type_id')
        .eq('user_id', actor.id)
        .in('schedule_id', scheduleIds)
        .order('work_date'),
      getShiftTypes(),
    ])
    if (myAssignmentsResult.error) throw new HttpError(500, myAssignmentsResult.error.message)
    const myAssignments = myAssignmentsResult.data ?? []

    const myTeamIds = [...new Set(
      myAssignments.map((a) => teamByScheduleId.get(String(a.schedule_id))).filter((t): t is string => Boolean(t)),
    )]
    const [blockedIds, teamMembers] = await Promise.all([
      getPendingAssignmentIds(myAssignments.map((assignment) => String(assignment.id))),
      getTeamMembersForTeams(myTeamIds),
    ])
    const typeById = new Map(shiftTypes.map((t) => [t.id, t]))
    const members = teamMembers
      .filter((member) => member.user_id !== actor.id)
      .map((member) => ({ userId: member.user_id, userName: member.displayName, teamId: member.team_id }))

    const describe = (a: { id: unknown; schedule_id: unknown; work_date: unknown; shift_type_id: unknown }) => {
      const type = typeById.get(String(a.shift_type_id))
      return {
        id: String(a.id),
        scheduleId: String(a.schedule_id),
        teamId: teamByScheduleId.get(String(a.schedule_id)) ?? '',
        date: String(a.work_date),
        code: type?.code ?? '?',
        typeName: type?.name_th ?? '?',
        selectable: String(a.work_date) >= today && !blockedIds.has(String(a.id)),
        unavailableReason: String(a.work_date) < today
          ? 'เวรที่ผ่านมาแล้ว'
          : blockedIds.has(String(a.id))
            ? 'อยู่ระหว่างคำขอแลก/ขาย'
            : null,
      }
    }

    return {
      mine: myAssignments.map(describe),
      members,
    }
  })
}
