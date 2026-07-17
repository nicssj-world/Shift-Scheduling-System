import { addDays, mondayOfWeek } from '@/lib/dates'
import { addRegularWork, toInterval, type Interval, type PersonState } from '@/lib/scheduler/constraints'
import type { AssignmentDraft, CarryIn, DayInfo, SchedulerConfig, SlotDef, Violation } from '@/lib/scheduler/types'

export type ValidateContext = {
  days: DayInfo[]
  slots: SlotDef[]
  unavailable: Record<string, string[]>
  config: SchedulerConfig
  carryIn?: CarryIn
}

const MAX_CONTIGUOUS_MIN = 16 * 60

/**
 * Re-check every hard rule against an arbitrary assignment set (auto-generated
 * or manually edited). Returns all violations found.
 */
export function validateAssignments(ctx: ValidateContext, assignments: AssignmentDraft[]): Violation[] {
  const violations: Violation[] = []
  const slotByCode = new Map(ctx.slots.map((s) => [s.code, s]))
  const dayByDate = new Map(ctx.days.map((d) => [d.date, d]))
  const daySet = new Set(ctx.days.map((d) => d.date))

  // --- coverage per day × slot ---
  const counts = new Map<string, number>()
  for (const a of assignments) {
    const k = `${a.date}|${a.code}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  for (const day of ctx.days) {
    for (const slot of ctx.slots) {
      const required = slot.requiredByDayClass[day.dayClass] ?? 0
      const actual = counts.get(`${day.date}|${slot.code}`) ?? 0
      if (actual < required) {
        violations.push({
          date: day.date, shiftTypeCode: slot.code, rule: 'understaffed', severity: 'error',
          message: `${day.date} ${slot.code}: ขาดคน ${actual}/${required}`,
        })
      } else if (actual > required && required > 0) {
        violations.push({
          date: day.date, shiftTypeCode: slot.code, rule: 'overstaffed', severity: 'warning',
          message: `${day.date} ${slot.code}: เกินกำหนด ${actual}/${required}`,
        })
      }
    }
  }

  // --- per-person checks ---
  const byUser = new Map<string, AssignmentDraft[]>()
  for (const a of assignments) {
    const list = byUser.get(a.userId) ?? []
    list.push(a)
    byUser.set(a.userId, list)
  }

  for (const [userId, list] of byUser) {
    const unavailable = new Set(ctx.unavailable[userId] ?? [])
    const intervals: Interval[] = []
    const workDates = new Set<string>()
    const person: PersonState = { intervals, workDates, monthCount: list.length, unavailable }

    for (const day of ctx.days) {
      if (day.dayClass === 'weekday' && !unavailable.has(day.date)) addRegularWork(person, day.date)
    }
    for (const date of ctx.carryIn?.regularWorkDates ?? []) addRegularWork(person, date)

    for (const a of list) {
      const slot = slotByCode.get(a.code)
      if (!slot) continue
      intervals.push(toInterval(a.date, slot))
      workDates.add(a.date)
      if (unavailable.has(a.date)) {
        violations.push({
          date: a.date, shiftTypeCode: a.code, userId, rule: 'leave', severity: 'error',
          message: `${a.date}: จัดเวรทับวันลา`,
        })
      }
    }
    for (const carry of ctx.carryIn?.assignments[userId] ?? []) {
      const slot = slotByCode.get(carry.code)
      if (slot) intervals.push(toInterval(carry.date, slot))
    }

    intervals.sort((a, b) => a.startAbs - b.startAbs)

    // overlaps
    for (let i = 0; i + 1 < intervals.length; i++) {
      if (intervals[i].endAbs > intervals[i + 1].startAbs) {
        violations.push({
          date: intervals[i + 1].date, userId, rule: 'overlap', severity: 'error',
          message: `${intervals[i + 1].date}: เวรซ้อนกัน (${intervals[i].code}/${intervals[i + 1].code})`,
        })
      }
    }

    // contiguous runs (doubles / >16h)
    let runStart = 0
    while (runStart < intervals.length) {
      let runEnd = runStart
      while (runEnd + 1 < intervals.length && intervals[runEnd + 1].startAbs === intervals[runEnd].endAbs) {
        runEnd += 1
      }
      const runOvertimeShifts = intervals.slice(runStart, runEnd + 1)
        .filter((interval) => !interval.isRegularWork).length
      const runMinutes = intervals[runEnd].endAbs - intervals[runStart].startAbs
      const inMonth = daySet.has(intervals[runEnd].date)
      if (inMonth && runMinutes > MAX_CONTIGUOUS_MIN) {
        violations.push({
          date: intervals[runEnd].date, userId, rule: 'max_consecutive_hours', severity: 'error',
          message: `${intervals[runEnd].date}: ทำงานติดต่อกันเกิน 16 ชม.`,
        })
      } else if (inMonth && runOvertimeShifts > 1 && !ctx.config.allowAfternoonNightDouble) {
        violations.push({
          date: intervals[runEnd].date, userId, rule: 'double_shift', severity: 'error',
          message: `${intervals[runEnd].date}: เวรควบไม่ได้รับอนุญาต`,
        })
      }
      runStart = runEnd + 1
    }

    // rest after night
    for (const night of intervals) {
      if (!night.isNight) continue
      for (const other of intervals) {
        if (other === night || other.isRegularWork || other.startAbs < night.endAbs) continue
        const gap = other.startAbs - night.endAbs
        if (gap > 0 && gap < ctx.config.minRestHoursAfterNight * 60 && daySet.has(other.date)) {
          violations.push({
            date: other.date, userId, rule: 'rest_after_night', severity: 'error',
            message: `${other.date}: พักหลังเวรดึกน้อยกว่า ${ctx.config.minRestHoursAfterNight} ชม.`,
          })
        }
      }
    }

    // max shifts per month
    const monthCount = list.filter((a) => daySet.has(a.date)).length
    if (monthCount > ctx.config.maxShiftsPerMonth) {
      violations.push({
        date: list[0]?.date ?? '', userId, rule: 'max_shifts', severity: 'error',
        message: `เกิน ${ctx.config.maxShiftsPerMonth} เวร/เดือน (${monthCount})`,
      })
    }

    // weekly day off (only weeks fully inside the schedule range)
    if (ctx.config.requireWeeklyDayOff) {
      const checkedWeeks = new Set<string>()
      for (const date of workDates) {
        if (!dayByDate.has(date)) continue
        const monday = mondayOfWeek(date)
        if (checkedWeeks.has(monday)) continue
        checkedWeeks.add(monday)
        const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
        if (!week.every((d) => daySet.has(d))) continue
        if (week.every((d) => workDates.has(d))) {
          violations.push({
            date: monday, userId, rule: 'weekly_day_off', severity: 'error',
            message: `สัปดาห์ ${monday}: ไม่มีวันหยุดประจำสัปดาห์`,
          })
        }
      }
    }
  }

  return violations
}
