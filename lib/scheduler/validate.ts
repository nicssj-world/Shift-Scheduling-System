import { addDays, mondayOfWeek } from '@/lib/dates'
import {
  addRegularWork, minimumRestHoursBetweenOt, toInterval, type Interval, type PersonState,
} from '@/lib/scheduler/constraints'
import type { AssignmentDraft, CarryIn, DayInfo, JobIn, SchedulerConfig, SlotDef, Violation } from '@/lib/scheduler/types'

export type ValidateShiftType = {
  id: string
  code: string
  isActive: boolean
}

export type ValidateMember = {
  userId: string
  isActive?: boolean
}

export type ValidateContext = {
  days: DayInfo[]
  /** Active, schedulable slots. */
  slots: SlotDef[]
  /** All shift types, including inactive ones, for structural validation. */
  shiftTypes?: ValidateShiftType[]
  /** Active members of the schedule's team. Omit in pure legacy fixtures. */
  members?: ValidateMember[]
  /** Active jobs for this team. */
  jobs?: JobIn[]
  /** Whether every filled position must carry one distinct active job. */
  usesJobs?: boolean
  /** Production schedules use exact staffing; legacy unit fixtures may opt out. */
  exactCoverage?: boolean
  /**
   * A published roster that has already been changed by a swap or sale is
   * allowed to drift from the original fairness distribution. Keep checking
   * all safety/coverage rules, but do not report workload-distribution rules.
   */
  suppressFairness?: boolean
  unavailable: Record<string, string[]>
  config: SchedulerConfig
  carryIn?: CarryIn
}

/** Stable identity used when comparing a roster before/after an edit. */
export function violationKey(violation: Violation) {
  return [violation.date, violation.shiftTypeCode ?? '', violation.userId ?? '', violation.rule].join('|')
}

const MAX_CONTIGUOUS_MIN = 16 * 60

/**
 * Re-check every hard rule against an arbitrary assignment set (auto-generated
 * or manually edited). This is intentionally the same rule vocabulary used by
 * the generator and owner-change validation.
 */
export function validateAssignments(ctx: ValidateContext, assignments: AssignmentDraft[]): Violation[] {
  const violations: Violation[] = []
  const suppressFairness = ctx.suppressFairness === true
  const slotByCode = new Map(ctx.slots.map((s) => [s.code, s]))
  const slotById = new Map(ctx.slots.map((s) => [s.shiftTypeId, s]))
  const allShiftTypes = new Map((ctx.shiftTypes ?? []).map((type) => [type.id, type]))
  const jobById = new Map((ctx.jobs ?? []).map((job) => [job.id, job]))
  // Production always passes the team's explicit uses_jobs policy. For old
  // pure fixtures, a non-empty jobs list retains the historical implication
  // that Job rotation is enabled.
  const usesJobs = ctx.usesJobs ?? Boolean(ctx.jobs && ctx.jobs.length > 0)
  // Contexts carrying production metadata are strict by default. Legacy
  // minimal fixtures can still opt into the old warning-only overstaffing
  // behaviour by omitting that metadata (or explicitly setting false).
  const exactCoverage = ctx.exactCoverage ?? Boolean(
    ctx.members || ctx.shiftTypes || ctx.jobs || ctx.usesJobs !== undefined,
  )
  const dayByDate = new Map(ctx.days.map((d) => [d.date, d]))
  const daySet = new Set(ctx.days.map((d) => d.date))
  const activeMemberIds = ctx.members
    ? new Set(ctx.members.filter((member) => member.isActive !== false).map((member) => member.userId))
    : undefined

  // --- structural checks + coverage per day × slot ---
  const counts = new Map<string, number>()
  const validAssignments: { assignment: AssignmentDraft; slot: SlotDef }[] = []
  const duplicateKeys = new Set<string>()
  const seenKeys = new Set<string>()
  const jobsByGroup = new Map<string, string[]>()

  for (const assignment of assignments) {
    const date = String(assignment.date)
    const userId = String(assignment.userId)
    const shiftTypeId = String(assignment.shiftTypeId)
    const slot = slotById.get(shiftTypeId) ?? slotByCode.get(String(assignment.code))
    const knownType = allShiftTypes.get(shiftTypeId)

    if (!daySet.has(date)) {
      violations.push({
        date,
        shiftTypeCode: String(assignment.code),
        userId,
        rule: 'date_out_of_range',
        severity: 'error',
        message: `${date}: assignment อยู่นอกเดือนของตาราง`,
      })
      continue
    }

    if (knownType && !knownType.isActive) {
      violations.push({
        date,
        shiftTypeCode: knownType.code,
        userId,
        rule: 'inactive_shift',
        severity: 'error',
        message: `${date}: ประเภทเวร ${knownType.code} ปิดใช้งานแล้ว`,
      })
      continue
    }
    if (allShiftTypes.size > 0 && !knownType) {
      violations.push({
        date,
        shiftTypeCode: String(assignment.code),
        userId,
        rule: 'inactive_shift',
        severity: 'error',
        message: `${date}: ไม่พบ shift type นี้ในระบบ`,
      })
      continue
    }
    if (!slot) {
      violations.push({
        date,
        shiftTypeCode: String(assignment.code),
        userId,
        rule: 'inactive_shift',
        severity: 'error',
        message: `${date}: ไม่พบประเภทเวรที่ใช้งานอยู่`,
      })
      continue
    }
    if (knownType && knownType.code !== slot.code) {
      violations.push({
        date,
        shiftTypeCode: String(assignment.code),
        userId,
        rule: 'invalid_shift_type',
        severity: 'error',
        message: `${date}: รหัสประเภทเวรไม่ตรงกับ shift type`,
      })
    }
    if (activeMemberIds && !activeMemberIds.has(userId)) {
      violations.push({
        date,
        shiftTypeCode: slot.code,
        userId,
        rule: 'non_team_member',
        severity: 'error',
        message: `${date}: ผู้รับเวรไม่ได้เป็นสมาชิกทีมที่ใช้งานอยู่`,
      })
    }

    const duplicateKey = `${date}|${slot.shiftTypeId}|${userId}`
    if (seenKeys.has(duplicateKey)) duplicateKeys.add(duplicateKey)
    seenKeys.add(duplicateKey)

    const required = slot.requiredByDayClass[dayByDate.get(date)!.dayClass] ?? 0
    const jobId = assignment.jobId ? String(assignment.jobId) : null
    if (jobId && (!usesJobs || !jobById.has(jobId))) {
      violations.push({
        date,
        shiftTypeCode: slot.code,
        userId,
        rule: 'invalid_job',
        severity: 'error',
        message: `${date} ${slot.code}: Job ไม่อยู่ในทีม หรือทีมนี้ไม่ใช้ Job`,
      })
    }
    if (usesJobs && required > 0 && !jobId) {
      violations.push({
        date,
        shiftTypeCode: slot.code,
        userId,
        rule: 'invalid_job',
        severity: 'error',
        message: `${date} ${slot.code}: assignment ต้องระบุ Job`,
      })
    }

    const coverageKey = `${date}|${slot.shiftTypeId}`
    counts.set(coverageKey, (counts.get(coverageKey) ?? 0) + 1)
    if (jobId) jobsByGroup.set(coverageKey, [...(jobsByGroup.get(coverageKey) ?? []), jobId])
    validAssignments.push({ assignment, slot })
  }

  for (const key of duplicateKeys) {
    const [date, shiftTypeId, userId] = key.split('|')
    const slot = slotById.get(shiftTypeId)
    violations.push({
      date,
      shiftTypeCode: slot?.code,
      userId,
      rule: 'duplicate_assignment',
      severity: 'error',
      message: `${date}: คนเดิมถูกใส่ assignment ซ้ำในเวรเดียวกัน`,
    })
  }

  for (const day of ctx.days) {
    for (const slot of ctx.slots) {
      const required = slot.requiredByDayClass[day.dayClass] ?? 0
      const actual = counts.get(`${day.date}|${slot.shiftTypeId}`) ?? 0
      if (actual < required) {
        violations.push({
          date: day.date,
          shiftTypeCode: slot.code,
          rule: 'understaffed',
          severity: 'error',
          message: `${day.date} ${slot.code}: ขาดคน ${actual}/${required}`,
        })
      } else if (actual > required && (exactCoverage || required > 0)) {
        violations.push({
          date: day.date,
          shiftTypeCode: slot.code,
          rule: 'overstaffed',
          severity: exactCoverage ? 'error' : 'warning',
          message: `${day.date} ${slot.code}: เกินกำหนด ${actual}/${required}`,
        })
      }
    }
  }

  // Holiday fairness remains a soft rule: leave, availability, or capacity
  // can make a perfectly even holiday split impossible. Surface it as a
  // warning while keeping per-shift-type balance as a hard rule below.
  const holidayCounts = new Map<string, number>()
  for (const { assignment } of validAssignments) {
    if (dayByDate.get(String(assignment.date))?.dayClass !== 'holiday') continue
    const userId = String(assignment.userId)
    holidayCounts.set(userId, (holidayCounts.get(userId) ?? 0) + 1)
  }
  const holidayUsers = ctx.members
    ? ctx.members.filter((member) => member.isActive !== false).map((member) => member.userId)
    : [...new Set(validAssignments.map(({ assignment }) => String(assignment.userId)))]
  if (!suppressFairness && holidayUsers.length > 0 && holidayCounts.size > 0) {
    const counts = holidayUsers.map((userId) => holidayCounts.get(userId) ?? 0)
    const max = Math.max(...counts)
    const min = Math.min(...counts)
    if (max - min > 1) {
      violations.push({
        date: ctx.days.find((day) => day.dayClass === 'holiday')?.date ?? '',
        rule: 'holiday_imbalance',
        severity: 'warning',
        message: `ภาระเวรวันหยุดต่างกัน ${max - min} เวร (มากที่สุด ${max} / น้อยที่สุด ${min})`,
      })
    }
  }

  // Each shift type is a separate hard fairness dimension. A person receiving
  // extra M/A/N assignments must not be hidden by an even overall total.
  const typeCounts = new Map<string, Map<string, number>>()
  for (const { assignment, slot } of validAssignments) {
    const userCounts = typeCounts.get(slot.code) ?? new Map<string, number>()
    const userId = String(assignment.userId)
    userCounts.set(userId, (userCounts.get(userId) ?? 0) + 1)
    typeCounts.set(slot.code, userCounts)
  }
  for (const slot of ctx.slots) {
    if (suppressFairness) continue
    if (!ctx.days.some((day) => (slot.requiredByDayClass[day.dayClass] ?? 0) > 0)) continue
    const counts = holidayUsers.map((userId) => typeCounts.get(slot.code)?.get(userId) ?? 0)
    if (counts.length === 0) continue
    const max = Math.max(...counts)
    const min = Math.min(...counts)
    if (max - min > 1) {
      violations.push({
        date: ctx.days[0]?.date ?? '',
        shiftTypeCode: slot.code,
        rule: 'type_imbalance',
        severity: 'error',
        message: `เวร ${slot.code} กระจายต่างกัน ${max - min} เวร (มากที่สุด ${max} / น้อยที่สุด ${min})`,
      })
    }
  }

  // --- distinct Job coverage ---
  if (usesJobs) {
    const jobs = ctx.jobs ?? []
    for (const day of ctx.days) {
      for (const slot of ctx.slots) {
        const required = slot.requiredByDayClass[day.dayClass] ?? 0
        if (required <= 0) continue
        const groupKey = `${day.date}|${slot.shiftTypeId}`
        if (jobs.length !== required) {
          violations.push({
            date: day.date,
            shiftTypeCode: slot.code,
            rule: 'job_coverage',
            severity: 'error',
            message: `${day.date} ${slot.code}: จำนวน Job (${jobs.length}) ไม่ตรงจำนวนคนที่ต้องการ (${required})`,
          })
          continue
        }
        const actualJobs = jobsByGroup.get(groupKey) ?? []
        if (actualJobs.length !== required) {
          violations.push({
            date: day.date,
            shiftTypeCode: slot.code,
            rule: 'job_coverage',
            severity: 'error',
            message: `${day.date} ${slot.code}: Job ต้องครบ ${required} ตำแหน่ง (พบ ${actualJobs.length})`,
          })
          continue
        }
        const jobCounts = new Map<string, number>()
        for (const jobId of actualJobs) jobCounts.set(jobId, (jobCounts.get(jobId) ?? 0) + 1)
        if (jobs.some((job) => jobCounts.get(job.id) !== 1)) {
          violations.push({
            date: day.date,
            shiftTypeCode: slot.code,
            rule: 'job_coverage',
            severity: 'error',
            message: `${day.date} ${slot.code}: Job ต้องไม่ซ้ำและต้องครบทุกตำแหน่ง`,
          })
        }
      }
    }
  }

  // --- per-person checks ---
  const byUser = new Map<string, { assignment: AssignmentDraft; slot: SlotDef }[]>()
  for (const item of validAssignments) {
    const list = byUser.get(String(item.assignment.userId)) ?? []
    list.push(item)
    byUser.set(String(item.assignment.userId), list)
  }

  // Validate every active team member, not only people who have an OT row in
  // this month. A member with only implicit weekday work (or a carry-in
  // boundary shift) can still violate the cross-month weekly-rest rule.
  const userIds = new Set<string>(byUser.keys())
  for (const member of ctx.members ?? []) {
    if (member.isActive !== false) userIds.add(member.userId)
  }
  for (const userId of Object.keys(ctx.carryIn?.assignments ?? {})) userIds.add(userId)
  for (const userId of Object.keys(ctx.carryIn?.futureAssignments ?? {})) userIds.add(userId)
  for (const userId of Object.keys(ctx.unavailable)) userIds.add(userId)

  for (const userId of userIds) {
    const list = byUser.get(userId) ?? []
    const unavailable = new Set(ctx.unavailable[userId] ?? [])
    const intervals: Interval[] = []
    const workDates = new Set<string>()
    const person: PersonState = { intervals, workDates, monthCount: list.length, unavailable }

    for (const day of ctx.days) {
      if (day.dayClass === 'weekday' && !unavailable.has(day.date)) addRegularWork(person, day.date)
    }
    for (const date of ctx.carryIn?.regularWorkDates ?? []) {
      if (!unavailable.has(date)) addRegularWork(person, date)
    }
    for (const date of ctx.carryIn?.futureRegularWorkDates ?? []) {
      if (!unavailable.has(date)) addRegularWork(person, date)
    }

    for (const { assignment, slot } of list) {
      intervals.push(toInterval(assignment.date, slot))
      // Approved leave is a non-working day even if an old/manual roster row
      // happens to remain on that date. Keep the interval so the invalid
      // assignment is still reported, but do not let it consume the person's
      // weekly day off.
      if (!unavailable.has(assignment.date)) workDates.add(assignment.date)
      if (unavailable.has(assignment.date)) {
        violations.push({
          date: assignment.date,
          shiftTypeCode: slot.code,
          userId,
          rule: 'leave',
          severity: 'error',
          message: `${assignment.date}: จัดเวรทับวันลา`,
        })
      }
    }
    for (const carry of ctx.carryIn?.assignments[userId] ?? []) {
      const slot = slotByCode.get(carry.code)
      if (slot) {
        intervals.push(toInterval(carry.date, slot))
        if (!unavailable.has(carry.date)) workDates.add(carry.date)
      }
    }
    for (const carry of ctx.carryIn?.futureAssignments?.[userId] ?? []) {
      const slot = slotByCode.get(carry.code)
      if (slot) {
        intervals.push(toInterval(carry.date, slot))
        if (!unavailable.has(carry.date)) workDates.add(carry.date)
      }
    }

    intervals.sort((a, b) => a.startAbs - b.startAbs || a.endAbs - b.endAbs)

    // overlaps
    for (let i = 0; i + 1 < intervals.length; i++) {
      if (intervals[i].endAbs > intervals[i + 1].startAbs) {
        violations.push({
          date: intervals[i + 1].date,
          userId,
          rule: 'overlap',
          severity: 'error',
          message: `${intervals[i + 1].date}: เวรซ้อนกัน (${intervals[i].code}/${intervals[i + 1].code})`,
        })
      }
    }

    // Consecutive night shifts are prohibited even when the configured rest
    // window would technically allow the 16-hour gap between them.
    const nightDates = new Set(intervals.filter((interval) => interval.isNight).map((interval) => interval.date))
    for (const nightDate of nightDates) {
      const followingDate = addDays(nightDate, 1)
      if (!nightDates.has(followingDate)) continue
      if (!daySet.has(nightDate) && !daySet.has(followingDate)) continue
      violations.push({
        date: daySet.has(followingDate) ? followingDate : nightDate,
        userId,
        shiftTypeCode: intervals.find((interval) => interval.date === followingDate)?.code
          ?? intervals.find((interval) => interval.date === nightDate)?.code,
        rule: 'consecutive_night',
        severity: 'error',
        message: `${nightDate} และ ${followingDate}: ห้ามจัดเวรดึกติดต่อกันสองวัน`,
      })
    }

    // contiguous runs (doubles / >16h)
    let runStart = 0
    while (runStart < intervals.length) {
      let runEnd = runStart
      while (runEnd + 1 < intervals.length && intervals[runEnd + 1].startAbs === intervals[runEnd].endAbs) runEnd += 1
      const runOvertimeShifts = intervals.slice(runStart, runEnd + 1).filter((interval) => !interval.isRegularWork).length
      const runMinutes = intervals[runEnd].endAbs - intervals[runStart].startAbs
      const touchesMonth = intervals.slice(runStart, runEnd + 1).some((interval) => daySet.has(interval.date))
      if (touchesMonth && runMinutes > MAX_CONTIGUOUS_MIN) {
        violations.push({
          date: intervals[runEnd].date,
          userId,
          rule: 'max_consecutive_hours',
          severity: 'error',
          message: `${intervals[runEnd].date}: ทำงานติดต่อกันเกิน 16 ชม.`,
        })
      } else if (touchesMonth && runOvertimeShifts > 1 && !ctx.config.allowAfternoonNightDouble) {
        violations.push({
          date: intervals[runEnd].date,
          userId,
          rule: 'double_shift',
          severity: 'error',
          message: `${intervals[runEnd].date}: เวรควบไม่ได้รับอนุญาต`,
        })
      }
      runStart = runEnd + 1
    }

    // Every pair of OT shifts needs at least the global minimum recovery time.
    // Implicit weekday 08:00–16:00 work is deliberately exempt because it is
    // the employee's ordinary shift, while still counting in the 16-hour
    // continuous-hours check above. Keep this in sync with checkAssignment so
    // generated, manually edited, published, and locked rosters use one rule.
    const overtimeIntervals = intervals.filter((interval) => !interval.isRegularWork)
    const minimumRestMinutes = minimumRestHoursBetweenOt(ctx.config) * 60
    for (let i = 0; i + 1 < overtimeIntervals.length; i++) {
      const earlier = overtimeIntervals[i]
      for (let j = i + 1; j < overtimeIntervals.length; j++) {
        const later = overtimeIntervals[j]
        const gap = later.startAbs - earlier.endAbs
        if (gap < 0) continue // overlap is reported by the check above
        const touchesScheduledMonth = daySet.has(earlier.date) || daySet.has(later.date)
        if (touchesScheduledMonth && gap < minimumRestMinutes) {
          violations.push({
            date: later.date,
            userId,
            shiftTypeCode: later.code,
            rule: 'minimum_rest_between_ot',
            severity: 'error',
            message: `${earlier.date} ${earlier.code} → ${later.date} ${later.code}: ต้องพักระหว่างเวร OT อย่างน้อย ${minimumRestHoursBetweenOt(ctx.config)} ชม.`,
          })
        }
      }
    }

    // max shifts per month (structurally valid, in-range assignments only)
    if (list.length > ctx.config.maxShiftsPerMonth) {
      violations.push({
        date: list[0]?.assignment.date ?? '',
        userId,
        rule: 'max_shifts',
        severity: 'error',
        message: `เกิน ${ctx.config.maxShiftsPerMonth} เวร/เดือน (${list.length})`,
      })
    }

    validateWeeklyRest(ctx, userId, workDates, violations)
  }

  return violations
}

function validateWeeklyRest(
  ctx: ValidateContext,
  userId: string,
  workDates: Set<string>,
  violations: Violation[],
) {
  if (!ctx.config.requireWeeklyDayOff || ctx.days.length === 0) return

  const daySet = new Set(ctx.days.map((day) => day.date))
  const boundaryKnown = new Set<string>([
    ...(ctx.carryIn?.regularWorkDates ?? []),
    ...(ctx.carryIn?.previousKnownDates ?? []),
    ...(ctx.carryIn?.futureRegularWorkDates ?? []),
    ...(ctx.carryIn?.futureKnownDates ?? []),
    ...Object.values(ctx.carryIn?.assignments ?? {}).flat().map((assignment) => assignment.date),
    ...Object.values(ctx.carryIn?.futureAssignments ?? {}).flat().map((assignment) => assignment.date),
  ])
  const mondays = new Set<string>()
  for (const date of [...daySet, ...boundaryKnown]) mondays.add(mondayOfWeek(date))

  for (const monday of mondays) {
    const week = Array.from({ length: 7 }, (_, index) => addDays(monday, index))
    if (!week.some((date) => daySet.has(date))) continue
    const known = week.filter((date) => daySet.has(date) || boundaryKnown.has(date))
    const allKnown = known.length === 7
    if (known.length === 0 || !known.every((date) => workDates.has(date))) continue

    if (allKnown) {
      violations.push({
        date: monday,
        userId,
        rule: 'weekly_day_off',
        severity: 'error',
        message: `สัปดาห์ ${monday}: ไม่มีวันหยุดประจำสัปดาห์`,
      })
    }
    // If the week crosses a month boundary and the adjacent roster is not
    // known, leave it unchecked for now. A future validation can hard-check
    // it once the neighboring roster exists; the current month must not be
    // forced to wait for a roster that has not been planned yet.
  }
}
