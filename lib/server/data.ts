import 'server-only'

import { datesOfMonth, isWeekend, previousMonth, timeToMinutes } from '@/lib/dates'
import { buildDisplayNames } from '@/lib/names'
import { HttpError } from '@/lib/server/errors'
import { DEFAULT_CONFIG, type CarryIn, type DayInfo, type SchedulerConfig, type SlotDef } from '@/lib/scheduler/types'
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
    .select('id,ephis_id,name,role,dept,phone,status,deleted_at')
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
  return ((data ?? []) as unknown as ShiftType[]).map((t) => ({ ...t, hours: Number(t.hours) }))
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
    .from('shift_holidays').select('holiday_date,name_th,kind')
    .gte('holiday_date', fromDate).lte('holiday_date', toDate)
    .order('holiday_date')
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as unknown as Holiday[]
}

export type MemberWithProfile = TeamMember & { profile: StaffProfile; displayName: string }

export async function getTeamMembers(teamId: string, activeOnly = true): Promise<MemberWithProfile[]> {
  let query = admin().from('shift_team_members').select('*').eq('team_id', teamId).order('sort_order')
  if (activeOnly) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw new HttpError(500, error.message)
  const members = (data ?? []) as unknown as TeamMember[]
  if (members.length === 0) return []

  const ids = members.map((m) => m.user_id)
  const { data: profiles, error: profileError } = await admin()
    .from('profiles').select('id,ephis_id,name,role,dept,phone').in('id', ids)
  if (profileError) throw new HttpError(500, profileError.message)
  const profileById = new Map((profiles ?? []).map((p) => [String(p.id), p]))

  const displayNames = buildDisplayNames(
    members.map((m) => ({
      userId: m.user_id,
      fullName: String(profileById.get(m.user_id)?.name ?? ''),
      displayLabel: m.display_label,
    })),
  )

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
        },
        displayName: displayNames.get(m.user_id) ?? String(p.name ?? ''),
      }
    })
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
      const startMin = timeToMinutes(t.start_time)
      let endMin = timeToMinutes(t.end_time)
      if (endMin === 0) endMin = 1440
      return {
        shiftTypeId: t.id,
        code: t.code,
        startMin,
        endMin,
        hours: Number(t.hours),
        requiredByDayClass: byClass,
      }
    })
}

/** Approved leave dates per user overlapping [from, to]. */
export async function getUnavailableDates(userIds: string[], from: string, to: string) {
  const result: Record<string, string[]> = {}
  if (userIds.length === 0) return result
  const { data, error } = await admin()
    .from('shift_leaves')
    .select('user_id,start_date,end_date,status')
    .in('user_id', userIds)
    .eq('status', 'approved')
    .lte('start_date', to)
    .gte('end_date', from)
  if (error) throw new HttpError(500, error.message)
  for (const leave of data ?? []) {
    const userId = String(leave.user_id)
    const dates = result[userId] ?? []
    let cursor = String(leave.start_date) < from ? from : String(leave.start_date)
    const end = String(leave.end_date) > to ? to : String(leave.end_date)
    while (cursor <= end) {
      dates.push(cursor)
      const d = new Date(`${cursor}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + 1)
      cursor = d.toISOString().slice(0, 10)
    }
    result[userId] = dates
  }
  return result
}

/**
 * Carry-in for fairness across months:
 * - totalCounts: lifetime shift count per person across EVERY prior schedule
 *   for this team (any month) — so whoever got the "extra" shift one month
 *   is deprioritized afterward instead of staying stuck with it forever;
 *   the odd shift rotates through everyone as history accumulates.
 * - shiftTypeCounts / jobCounts / assignments: previous-month-only data used
 *   for shift-type/job rotation smoothing and boundary rest/contiguity
 *   constraints across the month edge.
 */
export async function buildCarryIn(teamId: string, month: string, shiftTypes: ShiftType[], jobs: Job[]): Promise<CarryIn> {
  const prevMonth = previousMonth(month)
  const typeCodeById = new Map(shiftTypes.map((t) => [t.id, t.code]))
  const jobCodeById = new Map(jobs.map((j) => [j.id, j.code]))

  // Aggregated in Postgres (see shift_lifetime_totals in
  // 202607080003_shift_lifetime_totals_fn.sql) so this stays a flat, cheap
  // query — ~one row per team member — no matter how many months of history
  // pile up, instead of fetching every historical assignment row and summing
  // them in JS.
  const [{ data: totalsRows, error: totalsError }, { data: prevSchedule }] = await Promise.all([
    admin().rpc('shift_lifetime_totals', { p_team_id: teamId, p_exclude_month: `${month}-01` }),
    admin().from('shift_schedules').select('id').eq('team_id', teamId).eq('month', `${prevMonth}-01`).maybeSingle(),
  ])
  // Degrade to "no lifetime history" instead of breaking generate entirely if
  // the migration adding this function hasn't been run yet.
  if (totalsError) console.error('shift_lifetime_totals RPC failed (migration applied?):', totalsError.message)

  const totalCounts: Record<string, number> = {}
  for (const row of (totalsRows ?? []) as { user_id: string; total: number }[]) {
    totalCounts[String(row.user_id)] = Number(row.total)
  }

  if (!prevSchedule) return { assignments: {}, shiftTypeCounts: {}, jobCounts: {}, totalCounts }

  const rows = await getAssignments(String(prevSchedule.id))
  const prevDates = datesOfMonth(prevMonth)
  const boundary = new Set(prevDates.slice(-3))

  const carry: CarryIn = { assignments: {}, shiftTypeCounts: {}, jobCounts: {}, totalCounts }
  for (const row of rows) {
    const userId = String(row.user_id)
    const code = typeCodeById.get(String(row.shift_type_id))
    if (!code) continue
    const counts = (carry.shiftTypeCounts[userId] ??= {})
    counts[code] = (counts[code] ?? 0) + 1
    if (row.job_id) {
      const jobCode = jobCodeById.get(String(row.job_id))
      if (jobCode) {
        const jobCounts = (carry.jobCounts[userId] ??= {})
        jobCounts[jobCode] = (jobCounts[jobCode] ?? 0) + 1
      }
    }
    if (boundary.has(String(row.work_date))) {
      const list = (carry.assignments[userId] ??= [])
      list.push({ date: String(row.work_date), code })
    }
  }
  return carry
}
