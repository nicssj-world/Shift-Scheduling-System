import { requireScheduler } from '@/lib/server/auth'
import { bangkokDateString, datesOfMonth, nextMonth, previousMonth, thaiMonthLabel } from '@/lib/dates'
import {
  classifyDays, getHolidays, getRequirements, getSchedulerConfig, getTeamMembersForTeams, getTeams,
} from '@/lib/server/data'
import { getAttendanceMonthlyTotals } from '@/lib/server/attendance'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

type AnalyticsSchedule = { id: string; team_id: string; month: string }
type AnalyticsAssignment = { schedule_id: string; user_id: string }

function requiredForDays(
  days: Array<{ dayClass: string }>,
  requirements: Array<{ day_class: string; required_count: number }>,
) {
  let required = 0
  for (const day of days) {
    for (const requirement of requirements) {
      if (requirement.day_class === day.dayClass) required += requirement.required_count
    }
  }
  return required
}

/** Rule-based workforce analytics: workload, over-standard, forecast, trend. */
export async function GET() {
  return respond(async () => {
    await requireScheduler()
    const admin = getAdminClient()
    const currentMonth = bangkokDateString().slice(0, 7)

    // last 6 months incl. current
    const months: string[] = []
    let cursor = currentMonth
    for (let i = 0; i < 6; i++) {
      months.unshift(cursor)
      cursor = previousMonth(cursor)
    }
    const forecastMonth = nextMonth(currentMonth)
    const rangeMonths = [...months, forecastMonth]
    const rangeStart = datesOfMonth(months[0])[0]
    const rangeEndDates = datesOfMonth(forecastMonth)
    const rangeEnd = rangeEndDates[rangeEndDates.length - 1]

    // Load shared reference data and the holiday range in parallel. The previous
    // implementation fetched requirements, holidays, schedules, assignments and
    // leaves inside nested month/team loops, creating a large query waterfall.
    const [config, allTeams, allRequirements, holidays] = await Promise.all([
      getSchedulerConfig(),
      getTeams(),
      getRequirements(),
      getHolidays(rangeStart, rangeEnd),
    ])
    const teams = allTeams.filter((t) => t.is_active)
    const teamIds = teams.map((team) => team.id)

    // Fetch active members once after the team list is known. This is kept
    // separate from the reference-data batch above so an empty team list still
    // returns quickly without an unnecessary profiles query.
    const activeMembersPromise = teamIds.length > 0 ? getTeamMembersForTeams(teamIds) : Promise.resolve([])

    const requirementsByTeam = new Map<string, typeof allRequirements>()
    for (const requirement of allRequirements) {
      const teamRequirements = requirementsByTeam.get(requirement.team_id) ?? []
      teamRequirements.push(requirement)
      requirementsByTeam.set(requirement.team_id, teamRequirements)
    }
    const daysByMonth = new Map(
      rangeMonths.map((month) => [month, classifyDays(datesOfMonth(month), holidays)] as const),
    )

    const schedulesQuery = teamIds.length === 0
      ? Promise.resolve({ data: [] as AnalyticsSchedule[], error: null })
      : admin
        .from('shift_schedules')
        .select('id,team_id,month')
        .in('team_id', teamIds)
        .in('month', months.map((month) => `${month}-01`))
    const attendanceTotalsPromise = getAttendanceMonthlyTotals(rangeStart, rangeEnd)
    const [activeMembers, scheduleResult, attendanceTotals] = await Promise.all([
      activeMembersPromise,
      schedulesQuery,
      attendanceTotalsPromise,
    ])
    const { data: scheduleRows, error: schedulesError } = scheduleResult as unknown as {
      data: AnalyticsSchedule[] | null
      error: { message: string } | null
    }
    if (schedulesError) throw new HttpError(500, schedulesError.message)

    const nameByUser = new Map(activeMembers.map((m) => [m.user_id, m.displayName]))
    const totalStaff = new Set(activeMembers.map((m) => m.user_id)).size

    const schedules = (scheduleRows ?? []) as unknown as AnalyticsSchedule[]
    const scheduleIds = schedules.map((schedule) => String(schedule.id))
    const { data: assignmentRows, error: assignmentsError } = scheduleIds.length === 0
      ? { data: [] as AnalyticsAssignment[], error: null }
      : await admin
        .from('shift_assignments')
        .select('schedule_id,user_id')
        .in('schedule_id', scheduleIds)
    if (assignmentsError) throw new HttpError(500, assignmentsError.message)

    const scheduleByKey = new Map<string, string>()
    for (const schedule of schedules) {
      scheduleByKey.set(`${String(schedule.team_id)}|${String(schedule.month).slice(0, 10)}`, String(schedule.id))
    }
    const assignmentsBySchedule = new Map<string, AnalyticsAssignment[]>()
    for (const assignment of (assignmentRows ?? []) as unknown as AnalyticsAssignment[]) {
      const scheduleAssignments = assignmentsBySchedule.get(String(assignment.schedule_id)) ?? []
      scheduleAssignments.push(assignment)
      assignmentsBySchedule.set(String(assignment.schedule_id), scheduleAssignments)
    }
    const attendanceByMonth = new Map(attendanceTotals.map((row) => [row.month, row.total]))
    const leaveCountByMonth = new Map(rangeMonths.map((month) => [month, attendanceByMonth.get(month) ?? 0] as const))

    const trend: { month: string; label: string; filled: number; required: number; leaves: number }[] = []
    const personTotals: Record<string, { name: string; total: number; months: Record<string, number> }> = {}
    const insights: { severity: 'info' | 'warning' | 'error'; text: string }[] = []

    for (const month of months) {
      const days = daysByMonth.get(month) ?? []
      let filled = 0
      let required = 0

      for (const team of teams) {
        required += requiredForDays(days, requirementsByTeam.get(team.id) ?? [])
        const scheduleId = scheduleByKey.get(`${team.id}|${month}-01`)
        if (!scheduleId) continue
        const assignments = assignmentsBySchedule.get(scheduleId) ?? []
        filled += assignments.length
        for (const a of assignments) {
          const userId = String(a.user_id)
          const p = (personTotals[userId] ??= { name: nameByUser.get(userId) ?? '', total: 0, months: {} })
          p.total += 1
          p.months[month] = (p.months[month] ?? 0) + 1
        }
      }

      trend.push({
        month, label: thaiMonthLabel(month), filled, required,
        leaves: leaveCountByMonth.get(month) ?? 0,
      })
    }

    // over-standard detection (current month)
    const overStandard = Object.entries(personTotals)
      .map(([userId, p]) => ({ userId, name: p.name, count: p.months[currentMonth] ?? 0 }))
      .filter((p) => p.count > config.maxShiftsPerMonth)
    for (const p of overStandard) {
      insights.push({ severity: 'error', text: `${p.name} มีเวรเดือนนี้ ${p.count} เวร เกินมาตรฐาน ${config.maxShiftsPerMonth} เวร/เดือน` })
    }

    // imbalance (current month)
    const currentCounts = Object.values(personTotals)
      .map((p) => p.months[currentMonth] ?? 0)
      .filter((c) => c > 0)
    if (currentCounts.length > 1) {
      const spread = Math.max(...currentCounts) - Math.min(...currentCounts)
      if (spread > 4) {
        insights.push({ severity: 'warning', text: `ภาระงานเดือนนี้ไม่สมดุล ต่างกันสูงสุด ${spread} เวรต่อคน` })
      } else {
        insights.push({ severity: 'info', text: `ภาระงานเดือนนี้ค่อนข้างสมดุล (ต่างกันสูงสุด ${spread} เวร)` })
      }
    }

    // forecast next month: capacity vs demand
    const forecastDays = daysByMonth.get(forecastMonth) ?? []
    let demand = 0
    for (const team of teams) {
      demand += requiredForDays(forecastDays, requirementsByTeam.get(team.id) ?? [])
    }
    const leaveDaysNext = leaveCountByMonth.get(forecastMonth) ?? 0
    const capacity = totalStaff * config.maxShiftsPerMonth
    const utilization = capacity > 0 ? Math.round((demand / capacity) * 100) : 0
    insights.push({
      severity: utilization > 85 ? 'error' : utilization > 70 ? 'warning' : 'info',
      text: `คาดการณ์เดือน${thaiMonthLabel(forecastMonth)}: ต้องการ ${demand} เวร จากกำลังคนสูงสุด ${capacity} เวร (ใช้ ${utilization}%)${leaveDaysNext > 0 ? ` · มีรายการทะเบียนแล้ว ${leaveDaysNext} รายการ` : ''}`,
    })
    if (utilization > 85) {
      insights.push({ severity: 'error', text: 'แนวโน้มขาดแคลนบุคลากร: อัตราใช้กำลังคนสูงกว่า 85% ควรพิจารณาเพิ่มคนในทีมเวร' })
    }

    // coverage trend note
    const last = trend[trend.length - 1]
    if (last && last.required > 0) {
      const rate = Math.round((last.filled / last.required) * 100)
      insights.push({
        severity: rate < 90 ? 'warning' : 'info',
        text: `อัตราครอบคลุมเวรเดือนนี้ ${rate}% (${last.filled}/${last.required})`,
      })
    }

    return {
      trend,
      insights,
      overStandard,
      maxShiftsPerMonth: config.maxShiftsPerMonth,
      workloadRanking: Object.entries(personTotals)
        .map(([userId, p]) => ({ userId, name: p.name, current: p.months[currentMonth] ?? 0, sixMonths: p.total }))
        .sort((a, b) => b.sixMonths - a.sixMonths)
        .slice(0, 30),
      forecast: { month: forecastMonth, demand, capacity, utilization },
    }
  })
}
