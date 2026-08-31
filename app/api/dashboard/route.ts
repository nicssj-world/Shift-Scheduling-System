import { requireActor } from '@/lib/server/auth'
import { bangkokDateString, datesOfMonth } from '@/lib/dates'
import { attendanceReportCategory, attendanceReportValue, ATTENDANCE_CODE_TH, ATTENDANCE_REPORT_CATEGORY_TH, type AttendanceCode } from '@/lib/types'
import {
  buildDays, getAssignments, getRequirements, getShiftTypes, getTeamMembers, getTeams,
} from '@/lib/server/data'
import { getAttendanceDirectory } from '@/lib/server/attendance'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  return respond(async () => {
    await requireActor()
    const url = new URL(request.url)
    const month = url.searchParams.get('month') ?? bangkokDateString().slice(0, 7)
    const today = bangkokDateString()
    const admin = getAdminClient()

    const [teams, shiftTypes, days, attendancePeople] = await Promise.all([
      getTeams(), getShiftTypes(), buildDays(month), getAttendanceDirectory(),
    ])
    const typeById = new Map(shiftTypes.map((t) => [t.id, t]))
    const dates = datesOfMonth(month)

    const teamData = await Promise.all(
      teams.filter((t) => t.is_active).map(async (team) => {
        const [members, requirements] = await Promise.all([getTeamMembers(team.id), getRequirements(team.id)])
        const { data: schedule } = await admin
          .from('shift_schedules').select('id,status')
          .eq('team_id', team.id).eq('month', `${month}-01`).maybeSingle()
        const assignments = schedule ? await getAssignments(String(schedule.id)) : []

        let requiredTotal = 0
        for (const day of days) {
          for (const r of requirements) {
            if (r.day_class === day.dayClass) requiredTotal += r.required_count
          }
        }
        return { team, members, assignments, requiredTotal, scheduleStatus: schedule?.status ?? null }
      }),
    )

    // staff + today's duty
    const allMembers = teamData.flatMap((t) => t.members)
    const staffCount = new Set(allMembers.map((m) => m.user_id)).size
    const nameByUser = new Map([
      ...attendancePeople.map((person) => [person.id, person.name] as const),
      ...allMembers.map((m) => [m.user_id, m.displayName] as const),
    ])

    const todayByType: Record<string, { code: string; name: string; color: string; people: string[] }> = {}
    const shiftsByType: Record<string, number> = {}
    const workload: Record<string, { name: string; team: string; total: number; byDate: Record<string, number> }> = {}
    let filledTotal = 0
    let requiredTotal = 0

    for (const t of teamData) {
      requiredTotal += t.requiredTotal
      for (const a of t.assignments) {
        const type = typeById.get(String(a.shift_type_id))
        if (!type) continue
        filledTotal += 1
        shiftsByType[type.code] = (shiftsByType[type.code] ?? 0) + 1
        const userId = String(a.user_id)
        const w = (workload[userId] ??= {
          name: nameByUser.get(userId) ?? '', team: t.team.name_th, total: 0, byDate: {},
        })
        w.total += 1
        w.byDate[String(a.work_date)] = (w.byDate[String(a.work_date)] ?? 0) + 1
        if (String(a.work_date) === today) {
          const bucket = (todayByType[type.code] ??= { code: type.code, name: type.name_th, color: type.color, people: [] })
          bucket.people.push(nameByUser.get(userId) ?? '')
        }
      }
    }

    // The register is informational only; it never feeds scheduler coverage.
    const { data: monthAttendance, error: attendanceError } = await admin
      .from('shift_attendance_records').select('user_id,record_date,code')
      .is('deleted_at', null)
      .gte('record_date', dates[0])
      .lte('record_date', dates[dates.length - 1])
    if (attendanceError) throw new Error(attendanceError.message)
    const leavesByType: Record<string, number> = {}
    const onLeaveToday: { name: string; type: string }[] = []
    for (const row of monthAttendance ?? []) {
      const code = String(row.code) as AttendanceCode
      const category = attendanceReportCategory(code)
      const categoryLabel = ATTENDANCE_REPORT_CATEGORY_TH[category]
      leavesByType[categoryLabel] = (leavesByType[categoryLabel] ?? 0) + attendanceReportValue(code)
      if (String(row.record_date) === today) {
        onLeaveToday.push({ name: nameByUser.get(String(row.user_id)) ?? '', type: ATTENDANCE_CODE_TH[code] ?? code })
      }
    }

    return {
      month,
      today,
      staffCount,
      todayByType: Object.values(todayByType),
      onLeaveToday,
      coverage: { filled: filledTotal, required: requiredTotal },
      shiftsByType: shiftTypes
        .filter((t) => shiftsByType[t.code])
        .map((t) => ({ code: t.code, name: t.name_th, color: t.color, count: shiftsByType[t.code] ?? 0 })),
      leavesByType: Object.entries(leavesByType).map(([name, days]) => ({ name, days })),
      workload: Object.entries(workload)
        .map(([userId, w]) => ({ userId, ...w }))
        .sort((a, b) => b.total - a.total),
      teams: teamData.map((t) => ({
        id: t.team.id,
        name: t.team.name_th,
        members: t.members.length,
        required: t.requiredTotal,
        filled: t.assignments.length,
        scheduleStatus: t.scheduleStatus,
      })),
      dates,
    }
  })
}
