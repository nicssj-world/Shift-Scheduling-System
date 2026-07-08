import { requireActor } from '@/lib/server/auth'
import { bangkokDateString, datesOfMonth } from '@/lib/dates'
import {
  buildDays, getAssignments, getRequirements, getShiftTypes, getTeamMembers, getTeams,
} from '@/lib/server/data'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { LEAVE_TYPE_TH, leaveDays, type LeaveType } from '@/lib/types'

export async function GET(request: Request) {
  return respond(async () => {
    await requireActor()
    const url = new URL(request.url)
    const month = url.searchParams.get('month') ?? bangkokDateString().slice(0, 7)
    const today = bangkokDateString()
    const admin = getAdminClient()

    const [teams, shiftTypes, days] = await Promise.all([getTeams(), getShiftTypes(), buildDays(month)])
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
    const nameByUser = new Map(allMembers.map((m) => [m.user_id, m.displayName]))

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

    // leaves
    const { data: monthLeaves } = await admin
      .from('shift_leaves').select('user_id,leave_type,start_date,end_date,day_part,status')
      .eq('status', 'approved')
      .lte('start_date', dates[dates.length - 1])
      .gte('end_date', dates[0])
    const leavesByType: Record<string, number> = {}
    const onLeaveToday: { name: string; type: string }[] = []
    for (const leave of monthLeaves ?? []) {
      const type = LEAVE_TYPE_TH[String(leave.leave_type) as LeaveType] ?? String(leave.leave_type)
      leavesByType[type] = (leavesByType[type] ?? 0) +
        leaveDays({ start_date: String(leave.start_date), end_date: String(leave.end_date), day_part: String(leave.day_part) as 'full' })
      if (String(leave.start_date) <= today && today <= String(leave.end_date)) {
        onLeaveToday.push({ name: nameByUser.get(String(leave.user_id)) ?? '', type })
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
