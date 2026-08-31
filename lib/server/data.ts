import 'server-only'

import { datesOfMonth, isWeekend, nextMonth, previousMonth } from '@/lib/dates'
import { buildDisplayNames } from '@/lib/names'
import { HttpError } from '@/lib/server/errors'
import { DEFAULT_CONFIG, type CarryIn, type DayInfo, type SchedulerConfig, type SlotDef } from '@/lib/scheduler/types'
import { normalizeShiftTimes } from '@/lib/scheduler/shift-time'
import { getAdminClient } from '@/lib/supabase/admin'
import {
  normalizeRole,
  type DayClass, type Holiday, type Job, type Requirement, type Schedule, type ShiftType,
  type StaffProfile, type Team, type TeamMember,
} from '@/lib/types'

const admin = () => getAdminClient()

// ---------- staff directory ----------
export async function getStaffDirectory(): Promise<StaffProfile[]> {
  const { data, error } = await admin()
    .from('profiles')
    .select('id,ephis_id,name,role,dept,phone,position_title,employment_type,status,deleted_at')
    .order('name')
  if (error) throw new HttpError(500, error.message)
  return (data ?? [])
    .filter((p) => {
      const status = String(p.status ?? 'active').toLowerCase()
      return status === 'active' && !p.deleted_at
    })
    .map((p) => ({
      id: String(p.id),
      ephis_id: p.ephis_id ? String(p.ephis_id) : null,
      name: String(p.name ?? ''),
      role: normalizeRole(p.role ? String(p.role) : null),
      dept: p.dept ? String(p.dept) : null,
      phone: p.phone ? String(p.phone) : null,
      position_title: p.position_title ? String(p.position_title) : null,
      employment_type: p.employment_type ? String(p.employment_type) : null,
    }))
}

// ---------- settings ----------
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await admin().from('shift_settings').select('value').eq('key', key).maybeSingle()
  if (!data?.value) return fallback
  return { ...fallback, ...(data.value as object) } as T
}

export async function getSchedulerConfig(): Promise<SchedulerConfig> {
  const config = await getSetting<SchedulerConfig>('scheduler', DEFAULT_CONFIG)
  return { ...DEFAULT_CONFIG, ...config, weights: { ...DEFAULT_CONFIG.weights, ...config.weights } }
}

export async function getSwapSettings() {
  return getSetting<{ requiresApproval: boolean }>('swap', { requiresApproval: true })
}

export async function getSaleSettings() {
  return getSetting<{ requiresApproval: boolean }>('sale', { requiresApproval: true })
}

// ---------- reference data ----------
export async function getTeams(): Promise<Team[]> {
  const { data, error } = await admin().from('shift_teams').select('*').order('sort_order')
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as unknown as Team[]
}

export async function getTeam(teamId: string): Promise<Team> {
  const { data, error } = await admin().from('shift_teams').select('*').eq('id', teamId).maybeSingle()
  if (error || !data) throw new HttpError(404, 'ไม่พบทีม')
  return data as unknown as Team
}

export async function getShiftTypes(): Promise<ShiftType[]> {
  const { data, error } = await admin().from('shift_shift_types').select('*').order('sort_order')
  if (error) throw new HttpError(500, error.message)
  return ((data ?? []) as unknown as ShiftType[]).map((t) => {
    let normalized: ReturnType<typeof normalizeShiftTimes>
    try {
      normalized = normalizeShiftTimes(t.start_time, t.end_time, Number(t.hours))
    } catch (reason) {
      throw new HttpError(400, `ประเภทเวร ${t.code}: ${reason instanceof Error ? reason.message : 'เวลาไม่ถูกต้อง'}`)
    }
    return {
      ...t,
      hours: normalized.hours,
      // Keep existing installations usable before the flag migration is run;
      // once migrated, the persisted value is authoritative.
      triggers_rest_after_night: t.triggers_rest_after_night ?? String(t.code).toUpperCase() === 'N',
    }
  })
}

export async function getRequirements(teamId?: string): Promise<Requirement[]> {
  let query = admin().from('shift_requirements').select('*')
  if (teamId) query = query.eq('team_id', teamId)
  const { data, error } = await query
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as unknown as Requirement[]
}

export async function getJobs(teamId: string): Promise<Job[]> {
  const { data, error } = await admin()
    .from('shift_jobs').select('*').eq('team_id', teamId).eq('is_active', true).order('sort_order')
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as unknown as Job[]
}

export async function getHolidays(fromDate: string, toDate: string): Promise<Holiday[]> {
  const { data, error } = await admin()
    .from('shift_holidays').select('holiday_date,name_th,kind,source')
    .gte('holiday_date', fromDate).lte('holiday_date', toDate)
    .order('holiday_date')
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as unknown as Holiday[]
}

export type MemberWithProfile = TeamMember & { profile: StaffProfile; displayName: string }

/** Batch-load members and profiles for one or more teams without an N+1
 * profiles query per team. Display-name disambiguation remains team-scoped. */
export async function getTeamMembersForTeams(teamIds: string[], activeOnly = true): Promise<MemberWithProfile[]> {
  const uniqueTeamIds = [...new Set(teamIds)]
  if (uniqueTeamIds.length === 0) return []
  let query = admin().from('shift_team_members').select('*').in('team_id', uniqueTeamIds).order('sort_order')
  if (activeOnly) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw new HttpError(500, error.message)
  const members = (data ?? []) as unknown as TeamMember[]
  if (members.length === 0) return []

  const ids = [...new Set(members.map((m) => m.user_id))]
  const { data: profiles, error: profileError } = await admin()
    .from('profiles').select('id,ephis_id,name,role,dept,phone,position_title,employment_type').in('id', ids)
  if (profileError) throw new HttpError(500, profileError.message)
  const profileById = new Map((profiles ?? []).map((p) => [String(p.id), p]))

  const displayNamesByTeam = new Map<string, Map<string, string>>()
  for (const teamId of uniqueTeamIds) {
    const teamMembers = members.filter((member) => member.team_id === teamId)
    displayNamesByTeam.set(teamId, buildDisplayNames(
      teamMembers.map((member) => ({
        userId: member.user_id,
        fullName: String(profileById.get(member.user_id)?.name ?? ''),
        displayLabel: member.display_label,
      })),
    ))
  }

  return members
    .filter((m) => profileById.has(m.user_id))
    .map((m) => {
      const p = profileById.get(m.user_id)!
      return {
        ...m,
        profile: {
          id: String(p.id),
          ephis_id: p.ephis_id ? String(p.ephis_id) : null,
          name: String(p.name ?? ''),
          role: normalizeRole(p.role ? String(p.role) : null),
          dept: p.dept ? String(p.dept) : null,
          phone: p.phone ? String(p.phone) : null,
          position_title: p.position_title ? String(p.position_title) : null,
          employment_type: p.employment_type ? String(p.employment_type) : null,
        },
        displayName: displayNamesByTeam.get(m.team_id)?.get(m.user_id) ?? String(p.name ?? ''),
      }
    })
}

export async function getTeamMembers(teamId: string, activeOnly = true): Promise<MemberWithProfile[]> {
  return getTeamMembersForTeams([teamId], activeOnly)
}

// ---------- schedules ----------
export async function getSchedule(scheduleId: string): Promise<Schedule & { config: Record<string, unknown> }> {
  const { data, error } = await admin().from('shift_schedules').select('*').eq('id', scheduleId).maybeSingle()
  if (error || !data) throw new HttpError(404, 'ไม่พบตารางเวร')
  return data as unknown as Schedule & { config: Record<string, unknown> }
}

export async function getAssignments(scheduleId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await admin()
    .from('shift_assignments').select('*').eq('schedule_id', scheduleId).order('work_date')
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as Record<string, unknown>[]
}

// ---------- day classification + scheduler input ----------
/** Pure — classify already-fetched dates/holidays without another round trip. */
export function classifyDays(dates: string[], holidays: Holiday[]): DayInfo[] {
  const holidaySet = new Set(holidays.map((h) => h.holiday_date))
  return dates.map((date) => ({
    date,
    dayClass: (holidaySet.has(date) ? 'holiday' : isWeekend(date) ? 'weekend' : 'weekday') as DayClass,
  }))
}

export async function buildDays(month: string): Promise<DayInfo[]> {
  const dates = datesOfMonth(month)
  const holidays = await getHolidays(dates[0], dates[dates.length - 1])
  return classifyDays(dates, holidays)
}

export function buildSlots(shiftTypes: ShiftType[], requirements: Requirement[]): SlotDef[] {
  return shiftTypes
    .filter((t) => t.is_active)
    .map((t) => {
      const byClass: Record<DayClass, number> = { weekday: 0, weekend: 0, holiday: 0 }
      for (const r of requirements) {
        if (r.shift_type_id === t.id) byClass[r.day_class] = r.required_count
      }
      let normalized: ReturnType<typeof normalizeShiftTimes>
      try {
        normalized = normalizeShiftTimes(t.start_time, t.end_time, Number(t.hours))
      } catch (error) {
        throw new HttpError(400, `ประเภทเวร ${t.code}: ${error instanceof Error ? error.message : 'เวลาไม่ถูกต้อง'}`)
      }
      return {
        shiftTypeId: t.id,
        code: t.code,
        startMin: normalized.startMin,
        endMin: normalized.endMin,
        // Duration used by scheduling and reports must come from the actual
        // interval, not a separately editable value that may be stale.
        hours: normalized.hours,
        triggersRestAfterNight: Boolean(t.triggers_rest_after_night ?? String(t.code).toUpperCase() === 'N'),
        requiredByDayClass: byClass,
      }
    })
}

/**
 * Carry-in for fairness across months:
 * - totalCounts / shiftTypeCounts / jobCounts / weekendHolidayCounts /
 *   pairCounts: completed schedules in the preceding six calendar months.
 * - assignments / regularWorkDates and optional future* fields: six-day
 *   previous/next-month boundary context used for rest, 16-hour continuity,
 *   and cross-month weekly-day-off checks.
 */
export const FAIRNESS_WINDOW_MONTHS = 6

export async function buildCarryIn(teamId: string, month: string, shiftTypes: ShiftType[], jobs: Job[]): Promise<CarryIn> {
  const prevMonth = previousMonth(month)
  const followingMonth = nextMonth(month)
  const prevDates = datesOfMonth(prevMonth)
  const boundaryDates = prevDates.slice(-6)
  let fromMonth = prevMonth
  for (let i = 1; i < FAIRNESS_WINDOW_MONTHS; i++) fromMonth = previousMonth(fromMonth)
  const fromDates = datesOfMonth(fromMonth)
  const followingDates = datesOfMonth(followingMonth)
  const typeCodeById = new Map(shiftTypes.map((t) => [t.id, t.code]))
  const jobCodeById = new Map(jobs.map((j) => [j.id, j.code]))
  const empty = (totalCounts: Record<string, number> = {}): CarryIn => ({
    assignments: {}, shiftTypeCounts: {}, jobCounts: {}, weekendHolidayCounts: {}, pairCounts: {},
    regularWorkDates: [], totalCounts,
  })

  // Only completed rosters in the six calendar months immediately preceding
  // the target month influence fairness. In particular, never let a future
  // roster or an abandoned Draft bias a schedule being generated now.
  const [{ data: schedules, error: schedulesError }, { data: fairnessRows, error: fairnessError }, holidays, { data: followingSchedule, error: followingScheduleError }, followingHolidays] = await Promise.all([
    admin().from('shift_schedules').select('id,month,status')
      .eq('team_id', teamId)
      .gte('month', `${fromMonth}-01`)
      .lte('month', `${prevMonth}-01`)
      .in('status', ['published', 'locked']),
    admin().rpc('shift_rolling_fairness', {
      p_team_id: teamId,
      p_from_month: `${fromMonth}-01`,
      p_to_month: `${month}-01`,
    }),
    getHolidays(fromDates[0], prevDates[prevDates.length - 1]),
    admin().from('shift_schedules').select('id,month,status')
      .eq('team_id', teamId)
      .eq('month', `${followingMonth}-01`)
      .in('status', ['published', 'locked'])
      .maybeSingle(),
    getHolidays(followingDates[0], followingDates[5]),
  ])
  if (schedulesError) throw new HttpError(500, schedulesError.message)
  if (followingScheduleError) throw new HttpError(500, followingScheduleError.message)
  if (fairnessError) console.error('shift_rolling_fairness RPC failed (migration applied?):', fairnessError.message)

  const totalCounts: Record<string, number> = {}
  for (const row of (fairnessRows ?? []) as { user_id: string; total: number }[]) {
    totalCounts[String(row.user_id)] = Number(row.total)
  }
  const completed = (schedules ?? []).map((schedule) => ({ id: String(schedule.id), month: String(schedule.month).slice(0, 7) }))
  const previousScheduleIds = completed.map((schedule) => schedule.id)
  let rows: Record<string, unknown>[] = []
  // The normal path gets all fairness dimensions from the bounded SQL
  // aggregation above. Only an installation that has not run the migration
  // falls back to reading the bounded six-month rows temporarily.
  if (fairnessError && previousScheduleIds.length > 0) {
    const { data, error } = await admin().from('shift_assignments')
      .select('schedule_id,work_date,shift_type_id,user_id,job_id')
      .in('schedule_id', previousScheduleIds)
    if (error) throw new HttpError(500, error.message)
    rows = (data ?? []) as Record<string, unknown>[]
  }

  // Compatibility fallback for environments where the rolling aggregation
  // migration has not been run yet. The window is bounded to six months, so a
  // temporary application-side count is safe while the migration is applied.
  if (fairnessError || totalCounts.size === 0) {
    for (const row of rows ?? []) {
      const userId = String(row.user_id)
      totalCounts[userId] = (totalCounts[userId] ?? 0) + 1
    }
  }

  const holidaySet = new Set((holidays ?? []).map((holiday) => holiday.holiday_date))
  const previousScheduleId = completed.find((schedule) => schedule.month === prevMonth)?.id
  const regularWorkDates = previousScheduleId
    ? boundaryDates.filter((date) => !isWeekend(date) && !holidaySet.has(date))
    : []
  const futureBoundaryDates = followingDates.slice(0, 6)
  const futureHolidaySet = new Set((followingHolidays ?? []).map((holiday) => holiday.holiday_date))
  const futureRegularWorkDates = followingSchedule
    ? futureBoundaryDates.filter((date) => !isWeekend(date) && !futureHolidaySet.has(date))
    : []
  const carry = empty(totalCounts)
  carry.regularWorkDates = regularWorkDates
  carry.previousKnownDates = previousScheduleId ? boundaryDates : []
  carry.futureRegularWorkDates = futureRegularWorkDates
  carry.futureKnownDates = followingSchedule ? futureBoundaryDates : []

  let boundaryRows: Record<string, unknown>[] = []
  if (previousScheduleId) {
    const { data, error } = await admin().from('shift_assignments')
      .select('schedule_id,work_date,shift_type_id,user_id,job_id')
      .eq('schedule_id', previousScheduleId)
      .gte('work_date', boundaryDates[0])
      .lte('work_date', boundaryDates[boundaryDates.length - 1])
    if (error) throw new HttpError(500, error.message)
    boundaryRows = (data ?? []) as Record<string, unknown>[]
  }

  let futureRows: Record<string, unknown>[] = []
  if (followingSchedule) {
    const { data, error } = await admin().from('shift_assignments')
      .select('schedule_id,work_date,shift_type_id,user_id,job_id')
      .eq('schedule_id', String(followingSchedule.id))
      .gte('work_date', futureBoundaryDates[0])
      .lte('work_date', futureBoundaryDates[futureBoundaryDates.length - 1])
    if (error) throw new HttpError(500, error.message)
    futureRows = (data ?? []) as Record<string, unknown>[]
  }
  // Fairness dimensions are already grouped by Postgres in the normal path.
  // Keep the JS reduction solely as a bounded compatibility fallback when the
  // new RPC has not been deployed yet.
  if (fairnessError) {
    const groups = new Map<string, string[]>()
    for (const row of rows) {
      const userId = String(row.user_id)
      const code = typeCodeById.get(String(row.shift_type_id))
      if (!code) continue
      const counts = (carry.shiftTypeCounts[userId] ??= {})
      counts[code] = (counts[code] ?? 0) + 1
      const workDate = String(row.work_date)
      if (isWeekend(workDate) || holidaySet.has(workDate)) {
        carry.weekendHolidayCounts[userId] = (carry.weekendHolidayCounts[userId] ?? 0) + 1
      }
      const groupKey = `${String(row.schedule_id)}|${workDate}|${String(row.shift_type_id)}`
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), userId])
      if (row.job_id) {
        const jobCode = jobCodeById.get(String(row.job_id))
        if (jobCode) {
          const jobCounts = (carry.jobCounts[userId] ??= {})
          jobCounts[jobCode] = (jobCounts[jobCode] ?? 0) + 1
        }
      }
    }
    for (const group of groups.values()) {
      const userIds = [...new Set(group)].sort()
      for (let i = 0; i < userIds.length; i++) {
        for (let j = i + 1; j < userIds.length; j++) {
          const [a, b] = [userIds[i], userIds[j]]
          ;(carry.pairCounts[a] ??= {})[b] = (carry.pairCounts[a][b] ?? 0) + 1
          ;(carry.pairCounts[b] ??= {})[a] = (carry.pairCounts[b][a] ?? 0) + 1
        }
      }
    }
  } else {
    for (const row of (fairnessRows ?? []) as FairnessRow[]) {
      const userId = String(row.user_id)
      carry.shiftTypeCounts[userId] = parseCountMap(row.shift_type_counts)
      carry.jobCounts[userId] = parseCountMap(row.job_counts)
      carry.weekendHolidayCounts[userId] = Number(row.weekend_holiday ?? 0)
      carry.pairCounts[userId] = parseCountMap(row.pair_counts)
    }
  }

  // Boundary intervals are used for hard rest/16-hour checks only and come
  // from the immediately preceding completed roster.
  for (const row of boundaryRows) {
    const code = typeCodeById.get(String(row.shift_type_id))
    if (!code) continue
    const userId = String(row.user_id)
    const list = (carry.assignments[userId] ??= [])
    list.push({ date: String(row.work_date), code })
  }
  if (futureRows.length > 0) {
    for (const row of futureRows) {
      const code = typeCodeById.get(String(row.shift_type_id))
      if (!code) continue
      const userId = String(row.user_id)
      const list = (carry.futureAssignments ??= {})[userId] ?? []
      list.push({ date: String(row.work_date), code })
      carry.futureAssignments[userId] = list
    }
  }
  return carry
}

type FairnessRow = {
  user_id: string
  total: number
  shift_type_counts: unknown
  job_counts: unknown
  weekend_holiday: number
  pair_counts: unknown
}

function parseCountMap(value: unknown): Record<string, number> {
  let parsed: unknown = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return {} }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
    .map(([key, count]) => [key, Number(count)]).filter(([, count]) => Number.isFinite(count)))
}
