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
  const usesJobs = input.usesJobs ?? input.jobs.length > 0

  if (usesJobs) {
    for (const day of input.days) {
      for (const slot of input.slots) {
        const required = slot.requiredByDayClass[day.dayClass] ?? 0
        if (required > 0 && input.jobs.length !== required) {
          violations.push({
            date: day.date,
            shiftTypeCode: slot.code,
            rule: 'job_coverage',
            severity: 'error',
            message: `${day.date} ${slot.code}: จำนวน Job (${input.jobs.length}) ไม่ตรงจำนวนคนที่ต้องการ (${required})`,
          })
        }
      }
    }
  }

  const daySet = new Set(days.map((d) => d.date))
  const boundaryDates = new Set<string>([
    ...input.carryIn.regularWorkDates,
    ...(input.carryIn.previousKnownDates ?? []),
    ...(input.carryIn.futureRegularWorkDates ?? []),
    ...(input.carryIn.futureKnownDates ?? []),
    ...Object.values(input.carryIn.assignments).flat().map((assignment) => assignment.date),
    ...Object.values(input.carryIn.futureAssignments ?? {}).flat().map((assignment) => assignment.date),
  ])
  const knownDates = new Set([...daySet, ...boundaryDates])
  const weekDatesByDate = new Map<string, string[]>()
  for (const day of days) {
    const monday = mondayOfWeek(day.date)
    const week: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i)
      // Include known prior-month boundary dates so the first partial ISO
      // week of a month is checked continuously. Unknown future-month dates
      // remain outside the enforceable weekly-rest window for now.
      if (knownDates.has(d)) week.push(d)
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
    for (const date of input.carryIn.regularWorkDates) {
      if (!state.unavailable.has(date)) addRegularWork(state, date)
    }
    for (const date of input.carryIn.futureRegularWorkDates ?? []) {
      if (!state.unavailable.has(date)) addRegularWork(state, date)
    }
    // Previous-month boundary assignments: constrain rest/contiguity across
    // the month edge but do not count toward this month's totals.
    for (const carry of input.carryIn.assignments[member.userId] ?? []) {
      const slot = slotByCode.get(carry.code)
      if (slot) {
        state.intervals.push(toInterval(carry.date, slot))
        if (!state.unavailable.has(carry.date)) state.workDates.add(carry.date)
      }
    }
    // A completed next-month roster is optional. When present, its first six
    // days constrain the trailing boundary of this month as well.
    for (const carry of input.carryIn.futureAssignments?.[member.userId] ?? []) {
      const slot = slotByCode.get(carry.code)
      if (slot) {
        state.intervals.push(toInterval(carry.date, slot))
        if (!state.unavailable.has(carry.date)) state.workDates.add(carry.date)
      }
    }
    persons.set(member.userId, state)

    const personStats = emptyStats()
    personStats.byType = { ...(input.carryIn.shiftTypeCounts[member.userId] ?? {}) }
    personStats.byJob = { ...(input.carryIn.jobCounts[member.userId] ?? {}) }
    personStats.weekendHoliday = input.carryIn.weekendHolidayCounts[member.userId] ?? 0
    stats[member.userId] = personStats
  }

  // Schedule the scarcest shift type first. This is important when one type
  // only exists on weekends/holidays: assigning the daily types first can
  // consume exactly the people who still need that scarce type, producing a
  // false 0-versus-2 distribution even though the month is feasible.
  const orderedSlots = [...input.slots].sort((a, b) =>
    slotDemand(a, days) - slotDemand(b, days)
    || a.code.localeCompare(b.code)
    || a.startMin - b.startMin,
  )
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
            typeCount: personStats.currentByType[slot.code] ?? 0,
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
          const currentTypeDifference = (stats[a.member.userId].currentByType[slot.code] ?? 0)
            - (stats[b.member.userId].currentByType[slot.code] ?? 0)
          const historicalTypeDifference = (stats[a.member.userId].byType[slot.code] ?? 0)
            - (stats[b.member.userId].byType[slot.code] ?? 0)
          const holidayDifference = day.dayClass === 'holiday'
            ? stats[a.member.userId].holiday - stats[b.member.userId].holiday
            : 0
          const weekendHolidayDifference = day.dayClass === 'weekend'
            ? stats[a.member.userId].weekendHoliday - stats[b.member.userId].weekendHoliday
            : 0
          const aTotal = a.baseScore + pairingPenalty(a.member.userId, chosenIds, pairCounts, config.weights.pairing)
          const bTotal = b.baseScore + pairingPenalty(b.member.userId, chosenIds, pairCounts, config.weights.pairing)
          const totalDifference = stats[a.member.userId].total - stats[b.member.userId].total
          return (
            // Keep the monthly total inside a one-shift band. Type fairness
            // is applied inside that band so a low count for one type cannot
            // make somebody receive a third extra shift overall while another
            // eligible person is still two shifts behind.
            (Math.abs(totalDifference) > 1 ? totalDifference : 0) ||
            // On a holiday, first avoid assigning the next holiday to someone
            // who already has more holiday duty. This prevents a type-level
            // tie-break from recreating the same holiday imbalance.
            holidayDifference ||
            currentTypeDifference ||
            historicalTypeDifference ||
            totalDifference ||
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

      // `usesJobs` is explicit in production. Treat an omitted value as the
      // legacy "jobs array implies rotation" mode so existing pure fixtures
      // remain compatible; an explicit false always suppresses Job IDs.
      const jobMap = input.usesJobs === false ? new Map<string, string | null>() : assignJobs(chosen, input.jobs, stats)
      if (input.usesJobs === false) for (const member of chosen) jobMap.set(member.userId, null)

      for (const member of chosen) {
        const state = persons.get(member.userId)!
        addToPerson(state, day.date, slot)
        const personStats = stats[member.userId]
        personStats.total += 1
        personStats.byType[slot.code] = (personStats.byType[slot.code] ?? 0) + 1
        personStats.currentByType[slot.code] = (personStats.currentByType[slot.code] ?? 0) + 1
        if (day.dayClass !== 'weekday') personStats.weekendHoliday += 1
        if (day.dayClass === 'holiday') personStats.holiday += 1

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

  // A bounded deterministic repair pass catches the common case where a
  // chronological greedy choice consumed the only eligible person for a later
  // slot. It tries a direct placement or a bounded one/two-hop owner move,
  // and never accepts an intermediate state that violates a hard constraint.
  repairUnderstaffed(input, assignments, stats)

  // Remove deficit messages that the repair pass resolved. Any remaining
  // deficit is a genuine capacity/constraint conflict and stays an error.
  const remainingUnderstaffed = new Set<string>()
  for (const day of days) {
    for (const slot of input.slots) {
      const required = slot.requiredByDayClass[day.dayClass] ?? 0
      if (required <= 0) continue
      const actual = assignments.filter((assignment) => assignment.date === day.date && assignment.shiftTypeId === slot.shiftTypeId).length
      if (actual < required) remainingUnderstaffed.add(`${day.date}|${slot.code}`)
    }
  }
  for (let i = violations.length - 1; i >= 0; i--) {
    const violation = violations[i]
    if (violation.rule !== 'understaffed') continue
    const key = `${violation.date}|${violation.shiftTypeCode ?? ''}`
    if (!remainingUnderstaffed.has(key)) {
      violations.splice(i, 1)
      continue
    }
    const day = days.find((candidate) => candidate.date === violation.date)
    const slot = input.slots.find((candidate) => candidate.code === violation.shiftTypeCode)
    if (day && slot) violation.message = understaffedMessage(input, assignments, day, slot)
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

  // soft warning: public-holiday workload spread. The generator prioritizes
  // this burden before total workload, but leave and capacity can still make
  // a perfectly even split impossible.
  const holidayDays = days.filter((day) => day.dayClass === 'holiday')
  const holidayCounts = staff.map((member) => stats[member.userId].holiday)
  if (holidayDays.length > 0 && holidayCounts.length > 0) {
    const spread = Math.max(...holidayCounts) - Math.min(...holidayCounts)
    if (spread > 1) {
      violations.push({
        date: holidayDays[0].date,
        rule: 'holiday_imbalance',
        severity: 'warning',
        message: `ภาระเวรวันหยุดต่างกัน ${spread} เวร (มากที่สุด ${Math.max(...holidayCounts)} / น้อยที่สุด ${Math.min(...holidayCounts)})`,
      })
    }
  }

  // Hard fairness rule: each shift type must be balanced independently. The
  // current-month type count is intentionally separate from rolling history,
  // so no person may finish more than one assignment ahead of another for
  // the same shift type. Leave/capacity conflicts are surfaced as errors
  // instead of silently publishing an avoidably skewed roster.
  for (const slot of input.slots) {
    if (!days.some((day) => (slot.requiredByDayClass[day.dayClass] ?? 0) > 0)) continue
    const typeCounts = staff.map((member) => stats[member.userId].currentByType[slot.code] ?? 0)
    if (typeCounts.length === 0) continue
    const max = Math.max(...typeCounts)
    const min = Math.min(...typeCounts)
    if (max - min > 1) {
      violations.push({
        date: days[0]?.date ?? '',
        shiftTypeCode: slot.code,
        rule: 'type_imbalance',
        severity: 'error',
        message: `เวร ${slot.code} กระจายต่างกัน ${max - min} เวร (มากที่สุด ${max} / น้อยที่สุด ${min})`,
      })
    }
  }

  return { assignments, violations, stats }
}

/** Explain why the remaining positions could not be filled. The explanation
 * is intentionally based on the final repaired roster, so it reflects the
 * actual candidate eliminations rather than a stale pre-repair greedy pass. */
function understaffedMessage(
  input: SchedulerInput,
  assignments: AssignmentDraft[],
  day: SchedulerInput['days'][number],
  slot: SchedulerInput['slots'][number],
) {
  const slotByCode = new Map(input.slots.map((candidate) => [candidate.code, candidate]))
  const states = buildPersonStates(input, assignments, slotByCode)
  const groupUsers = new Set(assignments
    .filter((assignment) => assignment.date === day.date && assignment.shiftTypeId === slot.shiftTypeId)
    .map((assignment) => assignment.userId))
  const reasons = new Map<string, number>()
  const weekDates = knownWeekDates(input, day.date)
  for (const member of [...input.staff].sort((a, b) => a.key.localeCompare(b.key))) {
    if (groupUsers.has(member.userId)) {
      reasons.set('already_assigned', (reasons.get('already_assigned') ?? 0) + 1)
      continue
    }
    const state = states.get(member.userId)
    const check = state && checkAssignment(state, day.date, slot, input.config, weekDates)
    if (!check || !check.ok) {
      const rule = check && !check.ok ? check.rule : 'unknown'
      reasons.set(rule, (reasons.get(rule) ?? 0) + 1)
    }
  }
  const detail = [...reasons.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, count]) => `${rule}=${count}`)
    .join(', ')
  const actual = assignments.filter((assignment) => assignment.date === day.date && assignment.shiftTypeId === slot.shiftTypeId).length
  return `${day.date} ${slot.code}: จัดได้ ${actual}/${slot.requiredByDayClass[day.dayClass] ?? 0} คน (ผู้สมัครถูกตัดออก: ${detail || 'ไม่มีผู้สมัครที่ตรวจสอบได้'})`
}

function repairUnderstaffed(
  input: SchedulerInput,
  assignments: AssignmentDraft[],
  stats: Record<string, PersonStats>,
) {
  const dayByDate = new Map(input.days.map((day) => [day.date, day]))
  const slotById = new Map(input.slots.map((slot) => [slot.shiftTypeId, slot]))
  const slotByCode = new Map(input.slots.map((slot) => [slot.code, slot]))
  const orderedGroups = input.days.flatMap((day) => [...input.slots]
    .sort((a, b) => slotDemand(a, input.days) - slotDemand(b, input.days)
      || a.code.localeCompare(b.code)
      || a.startMin - b.startMin)
    .map((slot) => ({ day, slot })))

  for (const { day, slot } of orderedGroups) {
    const required = slot.requiredByDayClass[day.dayClass] ?? 0
    if (required <= 0) continue
    while (assignments.filter((assignment) => assignment.date === day.date && assignment.shiftTypeId === slot.shiftTypeId).length < required) {
      const states = buildPersonStates(input, assignments, slotByCode)
      const group = assignments.filter((assignment) => assignment.date === day.date && assignment.shiftTypeId === slot.shiftTypeId)
      const groupUsers = new Set(group.map((assignment) => assignment.userId))
      const weekDates = knownWeekDates(input, day.date)
      const candidates = [...input.staff]
        .sort((a, b) => a.key.localeCompare(b.key))
        .filter((member) => !groupUsers.has(member.userId))
        .sort((a, b) => {
          const aStats = stats[a.userId]
          const bStats = stats[b.userId]
          const currentTypeDifference = (aStats.currentByType[slot.code] ?? 0) - (bStats.currentByType[slot.code] ?? 0)
          const historicalTypeDifference = (aStats.byType[slot.code] ?? 0) - (bStats.byType[slot.code] ?? 0)
          const holidayDifference = day.dayClass === 'holiday'
            ? aStats.holiday - bStats.holiday
            : 0
          const weekendHolidayDifference = day.dayClass === 'weekend'
            ? aStats.weekendHoliday - bStats.weekendHoliday
            : 0
          const totalDifference = aStats.total - bStats.total
          return (Math.abs(totalDifference) > 1 ? totalDifference : 0)
            || holidayDifference
            || currentTypeDifference
            || historicalTypeDifference
            || totalDifference
            || weekendHolidayDifference
            || (fairnessScore(aStats, slot.code, day.dayClass, consecutiveWorkDaysBefore(states.get(a.userId)!.workDates, day.date), input.config.weights, input.carryIn.totalCounts[a.userId] ?? 0)
              - fairnessScore(bStats, slot.code, day.dayClass, consecutiveWorkDaysBefore(states.get(b.userId)!.workDates, day.date), input.config.weights, input.carryIn.totalCounts[b.userId] ?? 0))
            || tieBreakHash(`${day.date}|${slot.code}|${a.key}`) - tieBreakHash(`${day.date}|${slot.code}|${b.key}`)
            || a.key.localeCompare(b.key)
        })

      let placed = false
      for (const candidate of candidates) {
        const state = states.get(candidate.userId)
        if (!state || !checkAssignment(state, day.date, slot, input.config, weekDates).ok) continue
        assignments.push({
          date: day.date,
          shiftTypeId: slot.shiftTypeId,
          code: slot.code,
          userId: candidate.userId,
          jobId: repairJobId(assignments, day.date, slot.shiftTypeId, input),
        })
        incrementStats(stats[candidate.userId], assignments[assignments.length - 1], day.dayClass, input)
        placed = true
        break
      }
      if (placed) continue

      // Try a bounded chain of one or two owner moves. Every move is checked
      // against a rebuilt state before it is considered, then the target slot
      // is checked once more at the leaf. This makes the repair deterministic
      // while covering both a direct move and a two-hop swap.
      for (const candidate of candidates) {
        const repairBudget = { remaining: 500 }
        const repaired = findRepairPath(
          input, assignments, candidate.userId, day.date, slot, weekDates,
          slotByCode, slotById, dayByDate, 0, 2, repairBudget,
        )
        if (!repaired) continue

        for (let index = 0; index < assignments.length; index++) {
          const before = assignments[index]
          const after = repaired[index]
          if (!after || before.userId === after.userId) continue
          const oldDay = dayByDate.get(before.date)
          if (!oldDay) continue
          decrementStats(stats[before.userId], before, oldDay.dayClass, input)
          incrementStats(stats[after.userId], after, oldDay.dayClass, input)
        }
        assignments.splice(0, assignments.length, ...repaired)
        const targetAssignment: AssignmentDraft = {
          date: day.date,
          shiftTypeId: slot.shiftTypeId,
          code: slot.code,
          userId: candidate.userId,
          jobId: repairJobId(assignments, day.date, slot.shiftTypeId, input),
        }
        assignments.push(targetAssignment)
        incrementStats(stats[candidate.userId], targetAssignment, day.dayClass, input)
        placed = true
        break
      }
      if (!placed) break
    }
  }

  // Keep output stable after moved rows are appended.
  const slotOrder = new Map(input.slots.map((slot, index) => [slot.shiftTypeId, index]))
  assignments.sort((a, b) => a.date.localeCompare(b.date)
    || (slotOrder.get(a.shiftTypeId) ?? 0) - (slotOrder.get(b.shiftTypeId) ?? 0)
    || a.userId.localeCompare(b.userId))
}

function buildPersonStates(
  input: SchedulerInput,
  assignments: AssignmentDraft[],
  slotByCode: Map<string, SchedulerInput['slots'][number]>,
  omitIndex?: number | ReadonlySet<number>,
) {
  const states = new Map<string, PersonState>()
  const slotById = new Map(input.slots.map((slot) => [slot.shiftTypeId, slot]))
  for (const member of input.staff) {
    const state: PersonState = {
      intervals: [],
      workDates: new Set(),
      monthCount: 0,
      unavailable: new Set(input.unavailable[member.userId] ?? []),
    }
    for (const day of input.days) {
      if (day.dayClass === 'weekday' && !state.unavailable.has(day.date)) addRegularWork(state, day.date)
    }
    for (const date of input.carryIn.regularWorkDates) {
      if (!state.unavailable.has(date)) addRegularWork(state, date)
    }
    for (const carry of input.carryIn.assignments[member.userId] ?? []) {
      const slot = slotByCode.get(carry.code)
      if (slot) {
        state.intervals.push(toInterval(carry.date, slot))
        if (!state.unavailable.has(carry.date)) state.workDates.add(carry.date)
      }
    }
    for (const date of input.carryIn.futureRegularWorkDates ?? []) {
      if (!state.unavailable.has(date)) addRegularWork(state, date)
    }
    for (const carry of input.carryIn.futureAssignments?.[member.userId] ?? []) {
      const slot = slotByCode.get(carry.code)
      if (slot) {
        state.intervals.push(toInterval(carry.date, slot))
        if (!state.unavailable.has(carry.date)) state.workDates.add(carry.date)
      }
    }
    states.set(member.userId, state)
  }
  assignments.forEach((assignment, index) => {
    if (typeof omitIndex === 'number' ? index === omitIndex : omitIndex?.has(index)) return
    const state = states.get(assignment.userId)
    const slot = slotById.get(assignment.shiftTypeId) ?? slotByCode.get(assignment.code)
    if (!state || !slot) return
    addToPerson(state, assignment.date, slot)
  })
  return states
}

function findRepairPath(
  input: SchedulerInput,
  assignments: AssignmentDraft[],
  candidateId: string,
  targetDate: string,
  targetSlot: SchedulerInput['slots'][number],
  targetWeekDates: string[],
  slotByCode: Map<string, SchedulerInput['slots'][number]>,
  slotById: Map<string, SchedulerInput['slots'][number]>,
  dayByDate: Map<string, SchedulerInput['days'][number]>,
  depth: number,
  maxDepth: number,
  budget: { remaining: number },
): AssignmentDraft[] | null {
  if (budget.remaining <= 0) return null
  budget.remaining -= 1
  const states = buildPersonStates(input, assignments, slotByCode)
  const candidateState = states.get(candidateId)
  if (candidateState && checkAssignment(candidateState, targetDate, targetSlot, input.config, targetWeekDates).ok) {
    return assignments
  }
  if (depth >= maxDepth) return null

  for (let oldIndex = 0; oldIndex < assignments.length; oldIndex++) {
    const old = assignments[oldIndex]
    if (old.userId !== candidateId) continue
    const oldSlot = slotById.get(old.shiftTypeId) ?? slotByCode.get(old.code)
    const oldDay = dayByDate.get(old.date)
    if (!oldSlot || !oldDay || (old.date === targetDate && old.shiftTypeId === targetSlot.shiftTypeId)) continue

    const replacements = [...input.staff]
      .sort((a, b) => a.key.localeCompare(b.key))
      .filter((member) => member.userId !== candidateId)
    for (const replacement of replacements) {
      const moved = moveAssignmentWithCascade(
        input, assignments, oldIndex, replacement.userId,
        slotByCode, slotById, dayByDate, depth, maxDepth, budget,
        new Set([candidateId, replacement.userId]),
      )
      if (!moved) continue
      const result = findRepairPath(
        input, moved.assignments, candidateId, targetDate, targetSlot, targetWeekDates,
        slotByCode, slotById, dayByDate, depth + moved.moves, maxDepth, budget,
      )
      if (result) return result
    }
  }
  return null
}

type RepairMove = { assignments: AssignmentDraft[]; moves: number }

/**
 * Move one assignment to a new owner, recursively moving a blocking
 * assignment from that owner first when necessary. The child move is applied
 * before the parent move, so each intermediate roster is checked as a valid
 * state. `maxDepth` bounds this augmenting-path search to the requested
 * one/two-hop repair and `budget` keeps pathological fixtures deterministic
 * and finite.
 */
function moveAssignmentWithCascade(
  input: SchedulerInput,
  assignments: AssignmentDraft[],
  sourceIndex: number,
  targetUserId: string,
  slotByCode: Map<string, SchedulerInput['slots'][number]>,
  slotById: Map<string, SchedulerInput['slots'][number]>,
  dayByDate: Map<string, SchedulerInput['days'][number]>,
  depth: number,
  maxDepth: number,
  budget: { remaining: number },
  chainOwners: Set<string>,
): RepairMove | null {
  if (budget.remaining <= 0 || depth >= maxDepth) return null
  budget.remaining -= 1

  const source = assignments[sourceIndex]
  if (!source || source.userId === targetUserId) return null
  const sourceSlot = slotById.get(source.shiftTypeId) ?? slotByCode.get(source.code)
  if (!sourceSlot || !dayByDate.has(source.date)) return null

  const canTake = (candidateAssignments: AssignmentDraft[]) => {
    if (ownerAlreadyInGroup(candidateAssignments, sourceIndex, targetUserId)) return false
    const states = buildPersonStates(input, candidateAssignments, slotByCode, sourceIndex)
    const state = states.get(targetUserId)
    return Boolean(state && checkAssignment(
      state, source.date, sourceSlot, input.config, knownWeekDates(input, source.date),
    ).ok)
  }

  // The straightforward move is valid after removing the source row from the
  // destination owner's state.
  if (canTake(assignments)) {
    return {
      assignments: assignments.map((assignment, index) => (
        index === sourceIndex ? { ...assignment, userId: targetUserId } : assignment
      )),
      moves: 1,
    }
  }
  if (depth + 1 >= maxDepth) return null

  // The destination owner is blocked. Move one of that owner's assignments to
  // a third owner first, then retry the parent move. Since recursive children
  // are applied to the returned array, every successful intermediate state is
  // checked by the same central hard-constraint predicate.
  const blockingIndexes = assignments
    .map((assignment, index) => ({ assignment, index }))
    .filter(({ assignment, index }) => assignment.userId === targetUserId && index !== sourceIndex)
  const replacements = [...input.staff].sort((a, b) => a.key.localeCompare(b.key))
  for (const { index: blockingIndex } of blockingIndexes) {
    for (const replacement of replacements) {
      if (chainOwners.has(replacement.userId)) continue
      const child = moveAssignmentWithCascade(
        input, assignments, blockingIndex, replacement.userId,
        slotByCode, slotById, dayByDate, depth + 1, maxDepth, budget,
        new Set([...chainOwners, replacement.userId]),
      )
      if (!child) continue
      if (!canTake(child.assignments)) continue
      return {
        assignments: child.assignments.map((assignment, index) => (
          index === sourceIndex ? { ...assignment, userId: targetUserId } : assignment
        )),
        moves: child.moves + 1,
      }
    }
  }
  return null
}

function ownerAlreadyInGroup(assignments: AssignmentDraft[], sourceIndex: number, userId: string) {
  const source = assignments[sourceIndex]
  if (!source) return false
  return assignments.some((assignment, index) => (
    index !== sourceIndex
    && assignment.date === source.date
    && assignment.shiftTypeId === source.shiftTypeId
    && assignment.userId === userId
  ))
}

function knownWeekDates(input: SchedulerInput, date: string) {
  const known = new Set([
    ...input.days.map((day) => day.date),
    ...input.carryIn.regularWorkDates,
    ...(input.carryIn.previousKnownDates ?? []),
    ...(input.carryIn.futureRegularWorkDates ?? []),
    ...(input.carryIn.futureKnownDates ?? []),
    ...Object.values(input.carryIn.assignments).flat().map((assignment) => assignment.date),
    ...Object.values(input.carryIn.futureAssignments ?? {}).flat().map((assignment) => assignment.date),
  ])
  const monday = mondayOfWeek(date)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index)).filter((day) => known.has(day))
}

function repairJobId(assignments: AssignmentDraft[], date: string, shiftTypeId: string, input: SchedulerInput) {
  if (input.usesJobs === false || input.jobs.length === 0) return null
  const used = new Set(assignments
    .filter((assignment) => assignment.date === date && assignment.shiftTypeId === shiftTypeId)
    .map((assignment) => assignment.jobId)
    .filter((id): id is string => Boolean(id)))
  return input.jobs.find((job) => !used.has(job.id))?.id ?? null
}

function slotDemand(slot: SchedulerInput['slots'][number], days: SchedulerInput['days']) {
  return days.reduce((total, day) => total + (slot.requiredByDayClass[day.dayClass] ?? 0), 0)
}

function incrementStats(
  stats: PersonStats,
  assignment: AssignmentDraft,
  dayClass: 'weekday' | 'weekend' | 'holiday',
  input: SchedulerInput,
) {
  stats.total += 1
  stats.byType[assignment.code] = (stats.byType[assignment.code] ?? 0) + 1
  stats.currentByType[assignment.code] = (stats.currentByType[assignment.code] ?? 0) + 1
  if (dayClass !== 'weekday') stats.weekendHoliday += 1
  if (dayClass === 'holiday') stats.holiday += 1
  if (assignment.jobId) {
    const job = input.jobs.find((candidate) => candidate.id === assignment.jobId)
    if (job) stats.byJob[job.code] = (stats.byJob[job.code] ?? 0) + 1
  }
}

function decrementStats(
  stats: PersonStats,
  assignment: AssignmentDraft,
  dayClass: 'weekday' | 'weekend' | 'holiday',
  input: SchedulerInput,
) {
  stats.total = Math.max(0, stats.total - 1)
  stats.byType[assignment.code] = Math.max(0, (stats.byType[assignment.code] ?? 0) - 1)
  stats.currentByType[assignment.code] = Math.max(0, (stats.currentByType[assignment.code] ?? 0) - 1)
  if (dayClass !== 'weekday') stats.weekendHoliday = Math.max(0, stats.weekendHoliday - 1)
  if (dayClass === 'holiday') stats.holiday = Math.max(0, stats.holiday - 1)
  if (assignment.jobId) {
    const job = input.jobs.find((candidate) => candidate.id === assignment.jobId)
    if (job) stats.byJob[job.code] = Math.max(0, (stats.byJob[job.code] ?? 0) - 1)
  }
}
