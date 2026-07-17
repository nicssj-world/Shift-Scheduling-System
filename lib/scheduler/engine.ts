import { addDays, mondayOfWeek } from '@/lib/dates'
import { addRegularWork, addToPerson, checkAssignment, toInterval, type PersonState } from '@/lib/scheduler/constraints'
import {
  consecutiveWorkDaysBefore, emptyStats, fairnessScore, pairingPenalty, recordPairs, tieBreakHash, type PairCounts,
} from '@/lib/scheduler/fairness'
import { assignJobs } from '@/lib/scheduler/rotation'
import type {
  AssignmentDraft, PersonStats, SchedulerInput, SchedulerResult, Violation,
} from '@/lib/scheduler/types'

/**
 * Deterministic day-by-day greedy generator with fairness scoring.
 * Same input always yields the same output (no randomness; all ties broken
 * by explicit keys).
 */
export function generateSchedule(input: SchedulerInput): SchedulerResult {
  const { days, config } = input
  const violations: Violation[] = []
  const assignments: AssignmentDraft[] = []

  const daySet = new Set(days.map((d) => d.date))
  const weekDatesByDate = new Map<string, string[]>()
  for (const day of days) {
    const monday = mondayOfWeek(day.date)
    const week: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i)
      if (daySet.has(d)) week.push(d)
    }
    weekDatesByDate.set(day.date, week)
  }

  const slotByCode = new Map(input.slots.map((s) => [s.code, s]))
  const persons = new Map<string, PersonState>()
  const stats: Record<string, PersonStats> = {}
  const staff = [...input.staff].sort((a, b) => a.key.localeCompare(b.key))

  for (const member of staff) {
    const state: PersonState = {
      intervals: [],
      workDates: new Set(),
      monthCount: 0,
      unavailable: new Set(input.unavailable[member.userId] ?? []),
    }
    // Everyone works the implicit 08:00–16:00 regular shift on ordinary
    // weekdays unless on leave. It is not OT and does not increase the
    // monthly assignment total, but it must participate in the 16-hour cap
    // and physical day-off/consecutive-day checks.
    for (const day of days) {
      if (day.dayClass === 'weekday' && !state.unavailable.has(day.date)) addRegularWork(state, day.date)
    }
    for (const date of input.carryIn.regularWorkDates) addRegularWork(state, date)
    // Previous-month boundary assignments: constrain rest/contiguity across
    // the month edge but do not count toward this month's totals.
    for (const carry of input.carryIn.assignments[member.userId] ?? []) {
      const slot = slotByCode.get(carry.code)
      if (slot) {
        state.intervals.push(toInterval(carry.date, slot))
        state.workDates.add(carry.date)
      }
    }
    persons.set(member.userId, state)

    const personStats = emptyStats()
    personStats.byType = { ...(input.carryIn.shiftTypeCounts[member.userId] ?? {}) }
    personStats.byJob = { ...(input.carryIn.jobCounts[member.userId] ?? {}) }
    personStats.weekendHoliday = input.carryIn.weekendHolidayCounts[member.userId] ?? 0
    stats[member.userId] = personStats
  }

  const orderedSlots = [...input.slots].sort((a, b) => a.startMin - b.startMin || a.code.localeCompare(b.code))
  const pairCounts: PairCounts = Object.fromEntries(
    Object.entries(input.carryIn.pairCounts).map(([userId, counts]) => [userId, { ...counts }]),
  )

  for (const day of days) {
    for (const slot of orderedSlots) {
      const required = slot.requiredByDayClass[day.dayClass] ?? 0
      if (required <= 0) continue

      const weekDates = weekDatesByDate.get(day.date) ?? []
      const pool = staff
        .filter((member) => {
          const state = persons.get(member.userId)!
          return checkAssignment(state, day.date, slot, config, weekDates).ok
        })
        .map((member) => {
          const personStats = stats[member.userId]
          const state = persons.get(member.userId)!
          return {
            member,
            baseScore: fairnessScore(
              personStats,
              slot.code,
              day.dayClass,
              consecutiveWorkDaysBefore(state.workDates, day.date),
              config.weights,
              input.carryIn.totalCounts[member.userId] ?? 0,
            ),
            typeCount: personStats.byType[slot.code] ?? 0,
          }
        })

      // Pick one person at a time, re-scoring the remaining pool against
      // who's already been picked for this slot — a flat single sort would
      // keep choosing the same low-score pair together every time, since
      // their scores rise in lockstep whenever they're picked as a group.
      const chosenIds: string[] = []
      const chosen: typeof input.staff = []
      const remaining = [...pool]
      while (chosen.length < required && remaining.length > 0) {
        remaining.sort((a, b) => {
          // A monthly roster must stay balanced in its own right. Historical
          // totals can decide who gets an otherwise-tied extra shift, but
          // must not cause this month's workload to drift apart.
          const currentMonthDifference = stats[a.member.userId].total - stats[b.member.userId].total
          const weekendHolidayDifference = day.dayClass === 'weekday'
            ? 0
            : stats[a.member.userId].weekendHoliday - stats[b.member.userId].weekendHoliday
          const aTotal = a.baseScore + pairingPenalty(a.member.userId, chosenIds, pairCounts, config.weights.pairing)
          const bTotal = b.baseScore + pairingPenalty(b.member.userId, chosenIds, pairCounts, config.weights.pairing)
          return (
            currentMonthDifference ||
            weekendHolidayDifference ||
            aTotal - bTotal ||
            a.typeCount - b.typeCount ||
            tieBreakHash(`${day.date}|${slot.code}|${a.member.key}`) - tieBreakHash(`${day.date}|${slot.code}|${b.member.key}`) ||
            a.member.key.localeCompare(b.member.key)
          )
        })
        const picked = remaining.shift()!
        chosen.push(picked.member)
        chosenIds.push(picked.member.userId)
      }
      recordPairs(chosenIds, pairCounts)

      if (chosen.length < required) {
        violations.push({
          date: day.date,
          shiftTypeCode: slot.code,
          rule: 'understaffed',
          severity: 'error',
          message: `${day.date} ${slot.code}: จัดได้ ${chosen.length}/${required} คน (ไม่มีผู้มีสิทธิ์เพียงพอ)`,
        })
      }

      const jobMap = assignJobs(chosen, input.jobs, stats)

      for (const member of chosen) {
        const state = persons.get(member.userId)!
        addToPerson(state, day.date, slot)
        const personStats = stats[member.userId]
        personStats.total += 1
        personStats.byType[slot.code] = (personStats.byType[slot.code] ?? 0) + 1
        if (day.dayClass !== 'weekday') personStats.weekendHoliday += 1

        assignments.push({
          date: day.date,
          shiftTypeId: slot.shiftTypeId,
          code: slot.code,
          userId: member.userId,
          jobId: jobMap.get(member.userId) ?? null,
        })
      }
    }
  }

  // soft warning: workload spread
  const totals = staff.map((m) => stats[m.userId].total)
  if (totals.length > 0) {
    const spread = Math.max(...totals) - Math.min(...totals)
    if (spread > 1) {
      violations.push({
        date: days[0]?.date ?? '',
        rule: 'imbalance',
        severity: 'warning',
        message: `ภาระงานต่างกัน ${spread} เวรระหว่างคนมากสุด/น้อยสุด`,
      })
    }
  }

  return { assignments, violations, stats }
}
