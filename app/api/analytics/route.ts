import { requireScheduler } from '@/lib/server/auth'
import { bangkokDateString, datesOfMonth, nextMonth, previousMonth, thaiMonthLabel } from '@/lib/dates'
import {
  buildDays, getAssignments, getRequirements, getSchedulerConfig, getTeamMembers, getTeams,
} from '@/lib/server/data'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

/** Rule-based workforce analytics: workload, over-standard, forecast, trend. */
export async function GET() {
  return respond(async () => {
    await requireScheduler()
    const admin = getAdminClient()
    const currentMonth = bangkokDateString().slice(0, 7)
    const config = await getSchedulerConfig()
    const teams = (await getTeams()).filter((t) => t.is_active)

    // last 6 months incl. current
    const months: string[] = []
    let cursor = currentMonth
    for (let i = 0; i < 6; i++) {
      months.unshift(cursor)
      cursor = previousMonth(cursor)
    }

    const trend: { month: string; label: string; filled: number; required: number; leaves: number }[] = []
    const personTotals: Record<string, { name: string; total: number; months: Record<string, number> }> = {}
    const insights: { severity: 'info' | 'warning' | 'error'; text: string }[] = []

    const memberMaps = await Promise.all(teams.map((t) => getTeamMembers(t.id)))
    const nameByUser = new Map(memberMaps.flat().map((m) => [m.user_id, m.displayName]))
    const totalStaff = new Set(memberMaps.flat().map((m) => m.user_id)).size

    for (const month of months) {
      const dates = datesOfMonth(month)
      const days = await buildDays(month)
      let filled = 0
      let required = 0

      for (const team of teams) {
        const requirements = await getRequirements(team.id)
        for (const day of days) {
          for (const r of requirements) {
            if (r.day_class === day.dayClass) required += r.required_count
          }
        }
        const { data: schedule } = await admin
          .from('shift_schedules').select('id')
          .eq('team_id', team.id).eq('month', `${month}-01`).maybeSingle()
        if (!schedule) continue
        const assignments = await getAssignments(String(schedule.id))
        filled += assignments.length
        for (const a of assignments) {
          const userId = String(a.user_id)
          const p = (personTotals[userId] ??= { name: nameByUser.get(userId) ?? '', total: 0, months: {} })
          p.total += 1
          p.months[month] = (p.months[month] ?? 0) + 1
        }
      }

      const { data: leaves } = await admin
        .from('shift_leaves').select('id', { count: 'exact', head: true })
        .eq('status', 'approved')
        .lte('start_date', dates[dates.length - 1])
        .gte('end_date', dates[0])
      trend.push({
        month, label: thaiMonthLabel(month), filled, required,
        leaves: (leaves as unknown as { count?: number })?.count ?? 0,
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
    const forecastMonth = nextMonth(currentMonth)
    const forecastDays = await buildDays(forecastMonth)
    const forecastDates = datesOfMonth(forecastMonth)
    let demand = 0
    for (const team of teams) {
      const requirements = await getRequirements(team.id)
      for (const day of forecastDays) {
        for (const r of requirements) {
          if (r.day_class === day.dayClass) demand += r.required_count
        }
      }
    }
    const { data: futureLeaves } = await admin
      .from('shift_leaves').select('user_id,start_date,end_date')
      .eq('status', 'approved')
      .lte('start_date', forecastDates[forecastDates.length - 1])
      .gte('end_date', forecastDates[0])
    const leaveDaysNext = (futureLeaves ?? []).length
    const capacity = totalStaff * config.maxShiftsPerMonth
    const utilization = capacity > 0 ? Math.round((demand / capacity) * 100) : 0
    insights.push({
      severity: utilization > 85 ? 'error' : utilization > 70 ? 'warning' : 'info',
      text: `คาดการณ์เดือน${thaiMonthLabel(forecastMonth)}: ต้องการ ${demand} เวร จากกำลังคนสูงสุด ${capacity} เวร (ใช้ ${utilization}%)${leaveDaysNext > 0 ? ` · มีใบลาแล้ว ${leaveDaysNext} รายการ` : ''}`,
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
