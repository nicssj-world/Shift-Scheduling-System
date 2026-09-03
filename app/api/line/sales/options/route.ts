import { requireLineSessionActor } from '@/lib/server/line-session'
import { getLineSettings } from '@/lib/server/line-config'
import { getSaleSettings, getShiftTypes, getTeamMembersForTeams, getTeams } from '@/lib/server/data'
import { expireOpenSaleListings, normalizeOpenSaleMonthRange } from '@/lib/server/open-sales'
import { getAdminClient } from '@/lib/supabase/admin'
import { bangkokDateString } from '@/lib/dates'
import { HttpError } from '@/lib/server/errors'
import { getPendingAssignmentIds } from '@/lib/server/request-conflicts'
import { respond } from '@/lib/server/route'

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireLineSessionActor()
    const settings = await getLineSettings()
    const saleSettings = await getSaleSettings()
    if (!settings.enabled || !settings.saleEnabled || !settings.openSaleEnabled || !saleSettings.openEnabled) {
      throw new HttpError(403, 'การขายเวรผ่าน LINE ยังไม่เปิดใช้งาน')
    }
    await expireOpenSaleListings()
    const params = new URL(request.url).searchParams
    const months = normalizeOpenSaleMonthRange(params.get('from'), params.get('to'))
    const allTeams = (await getTeams()).filter((team) => team.is_active)
    const { data: memberships } = await getAdminClient().from('shift_team_members')
      .select('team_id').eq('user_id', actor.id).eq('is_active', true)
    const memberTeamIds = new Set((memberships ?? []).map((row) => String(row.team_id)))
    const teams = allTeams.filter((team) => actor.isScheduler || memberTeamIds.has(String(team.id)))
    const teamId = params.get('teamId')
    if (teamId && !teams.some((team) => String(team.id) === teamId)) throw new HttpError(403, 'คุณไม่มีสิทธิ์ดูทีมนี้')
    const selectedTeams = teamId ? teams.filter((team) => String(team.id) === teamId) : teams
    if (selectedTeams.length === 0) return { from: months[0], to: months.at(-1), today: bangkokDateString(), teams: [], members: [], mine: [] }
    const admin = getAdminClient()
    const { data: schedules, error: scheduleError } = await admin.from('shift_schedules')
      .select('id,team_id,month,status').in('team_id', selectedTeams.map((team) => String(team.id)))
      .gte('month', `${months[0]}-01`).lte('month', `${months.at(-1)}-01`).eq('status', 'published')
    if (scheduleError) throw new HttpError(500, 'อ่านตารางเวรไม่สำเร็จ')
    const scheduleRows = schedules ?? []
    const scheduleIds = scheduleRows.map((row) => String(row.id))
    const [{ data: assignments, error: assignmentError }, members, types] = await Promise.all([
      scheduleIds.length ? admin.from('shift_assignments').select('id,schedule_id,work_date,shift_type_id,user_id').in('schedule_id', scheduleIds).eq('user_id', actor.id).gte('work_date', bangkokDateString()).order('work_date') : Promise.resolve({ data: [], error: null }),
      getTeamMembersForTeams(selectedTeams.map((team) => String(team.id))),
      getShiftTypes(),
    ])
    if (assignmentError) throw new HttpError(500, 'อ่านเวรของคุณไม่สำเร็จ')
    const reserved = await getPendingAssignmentIds((assignments ?? []).map((row) => String(row.id)))
    const scheduleById = new Map(scheduleRows.map((row) => [String(row.id), row]))
    const typeById = new Map(types.map((type) => [String(type.id), type]))
    return {
      from: months[0],
      to: months.at(-1),
      today: bangkokDateString(),
      teams: selectedTeams.map((team) => ({ id: String(team.id), code: team.code, name: team.name_th })),
      members: members.map((member) => ({ userId: member.user_id, userName: member.displayName, teamId: member.team_id })),
      mine: (assignments ?? []).filter((row) => !reserved.has(String(row.id))).map((row) => {
        const type = typeById.get(String(row.shift_type_id))
        return {
          id: String(row.id),
          scheduleId: String(row.schedule_id),
          teamId: String(scheduleById.get(String(row.schedule_id))?.team_id ?? ''),
          workDate: String(row.work_date),
          shiftTypeId: String(row.shift_type_id),
          code: type?.code ?? '?',
          typeName: type?.name_th ?? '?',
          startTime: type?.start_time?.slice(0, 5) ?? '',
          endTime: type?.end_time?.slice(0, 5) ?? '',
          userId: String(row.user_id),
          userName: actor.name,
          mine: true,
        }
      }),
    }
  })
}
