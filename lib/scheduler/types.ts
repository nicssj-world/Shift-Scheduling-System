import type { DayClass } from '@/lib/types'

export type SlotDef = {
  shiftTypeId: string
  code: string
  /** minutes from midnight of work_date */
  startMin: number
  /** may be 1440 for a shift ending at 24:00 */
  endMin: number
  hours: number
  requiredByDayClass: Record<DayClass, number>
}

export type DayInfo = { date: string; dayClass: DayClass }

export type SchedulerWeights = {
  total: number
  type: number
  weekend: number
  consecutive: number
  /** Penalty per prior shared shift with someone already picked for the same
   *  slot — discourages the same pairs of people always working together. */
  pairing: number
}

export type SchedulerConfig = {
  maxShiftsPerMonth: number
  allowAfternoonNightDouble: boolean
  minRestHoursAfterNight: number
  requireWeeklyDayOff: boolean
  weights: SchedulerWeights
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  maxShiftsPerMonth: 24,
  allowAfternoonNightDouble: true,
  minRestHoursAfterNight: 8,
  requireWeeklyDayOff: true,
  weights: { total: 10, type: 4, weekend: 6, consecutive: 3, pairing: 4 },
}

export type StaffIn = {
  userId: string
  /** stable deterministic tiebreak key (ephis id) */
  key: string
}

export type JobIn = { id: string; code: string; sortOrder: number }

/** Assignment from the previous month used for boundary constraints + fairness carry-in. */
export type CarryIn = {
  /** userId → assignments near the month boundary: [{date, code}] */
  assignments: Record<string, { date: string; code: string }[]>
  /** userId → shift type code → historical count (previous month only) */
  shiftTypeCounts: Record<string, Record<string, number>>
  /** userId → job code → historical count (previous month only) */
  jobCounts: Record<string, Record<string, number>>
  /** userId → prior-month weekend/holiday shift count. */
  weekendHolidayCounts: Record<string, number>
  /** Prior-month co-worker pair counts, used to avoid restarting the same
   * pairings at every month boundary. */
  pairCounts: Record<string, Record<string, number>>
  /** Regular 08:00–16:00 work dates near the previous-month boundary.
   * These are not OT and do not count toward shift totals, but they do count
   * toward the hard 16-hour continuous-work limit. */
  regularWorkDates: string[]
  /** userId → total shifts ever worked on this team, across all prior
   *  months. Seeds fairness scoring so someone who got the "extra" shift
   *  one month is deprioritized in later months instead of staying stuck
   *  with it — the odd shift rotates through everyone over time. */
  totalCounts: Record<string, number>
}

export type SchedulerInput = {
  days: DayInfo[]
  slots: SlotDef[]
  staff: StaffIn[]
  /** userId → dates unavailable (approved leave) */
  unavailable: Record<string, string[]>
  /** empty array when the team has no job rotation */
  jobs: JobIn[]
  carryIn: CarryIn
  config: SchedulerConfig
}

export type AssignmentDraft = {
  date: string
  shiftTypeId: string
  code: string
  userId: string
  jobId: string | null
}

export type Violation = {
  date: string
  shiftTypeCode?: string
  userId?: string
  rule: string
  severity: 'error' | 'warning'
  message: string
}

export type PersonStats = {
  total: number
  byType: Record<string, number>
  weekendHoliday: number
  byJob: Record<string, number>
}

export type SchedulerResult = {
  assignments: AssignmentDraft[]
  violations: Violation[]
  stats: Record<string, PersonStats>
}

export const EMPTY_CARRY_IN: CarryIn = {
  assignments: {},
  shiftTypeCounts: {},
  jobCounts: {},
  weekendHolidayCounts: {},
  pairCounts: {},
  regularWorkDates: [],
  totalCounts: {},
}
