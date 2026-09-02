import 'server-only'

import { datesOfMonth } from '@/lib/dates'
import { generateSchedule } from '@/lib/scheduler/engine'
import { addRegularWork, addToPerson, checkAssignment, toInterval, type PersonState } from '@/lib/scheduler/constraints'
import { consecutiveWorkDaysBefore, emptyStats, fairnessScore } from '@/lib/scheduler/fairness'
import type { AssignmentDraft, SchedulerInput, Violation } from '@/lib/scheduler/types'
import { validateAssignments, type ValidateContext } from '@/lib/scheduler/validate'
import {
  buildCarryIn, buildDays, buildSlots, classifyDays, getAssignments, getHolidays, getJobs, getRequirements,
  getSchedule, getSchedulerConfig, getShiftTypes, getTeam, getTeamMembers, getTeams,
  type MemberWithProfile,
} from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'
import type { Actor, Assignment, Schedule } from '@/lib/types'
import { addDays, mondayOfWeek } from '@/lib/dates'

const MONTH_RE = /^\d{4}-\d{2}$/

export function assertMonth(month: string) {
  if (!MONTH_RE.test(month)) throw new HttpError(400, 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)')
  return month
}

export type ScheduleContext = {
  schedule: Schedule
  team: Awaited<ReturnType<typeof getTeam>>
  teamId: string
  month: string
  members: MemberWithProfile[]
  slots: ReturnType<typeof buildSlots>
  days: Awaited<ReturnType<typeof buildDays>>
  unavailable: Record<string, string[]>
  carryIn: Awaited<ReturnType<typeof buildCarryIn>>
  config: Awaited<ReturnType<typeof getSchedulerConfig>>
  jobs: Awaited<ReturnType<typeof getJobs>>
  shiftTypes: Awaited<ReturnType<typeof getShiftTypes>>
}

export async function loadScheduleContext(scheduleId: string): Promise<ScheduleContext> {
  const schedule = await getSchedule(scheduleId)
  const month = String(schedule.month).slice(0, 7)
  const teamId = schedule.team_id
  const dates = datesOfMonth(month)

  const [team, shiftTypes, requirements, jobs, holidays, members, config] = await Promise.all([
    getTeam(teamId), getShiftTypes(), getRequirements(teamId), getJobs(teamId),
    getHolidays(dates[0], dates[dates.length - 1]),
    getTeamMembers(teamId), getSchedulerConfig(),
  ])
  const days = classifyDays(dates, holidays)

  // The leave/attendance register is informational only. Keep the scheduler's
  // generic unavailable input available for pure-engine callers, but do not
  // feed any leave/attendance register into it.
  const unavailable: Record<string, string[]> = {}
  const carryIn = await buildCarryIn(teamId, month, shiftTypes, jobs)

  return {
    schedule: schedule as Schedule, team, teamId, month, members,
    slots: buildSlots(shiftTypes, requirements), days, unavailable, carryIn, config, jobs, shiftTypes,
  }
}

export function toDrafts(ctx: ScheduleContext, rows: Record<string, unknown>[]): AssignmentDraft[] {
  const codeById = new Map(ctx.shiftTypes.map((t) => [t.id, t.code]))
  return rows.map((r) => ({
    date: String(r.work_date),
    shiftTypeId: String(r.shift_type_id),
    code: codeById.get(String(r.shift_type_id)) ?? '?',
    userId: String(r.user_id),
    jobId: r.job_id ? String(r.job_id) : null,
  }))
}

export function toValidateContext(ctx: ScheduleContext): ValidateContext {
  return {
    days: ctx.days,
    slots: ctx.slots,
    shiftTypes: ctx.shiftTypes.map((type) => ({ id: type.id, code: type.code, isActive: type.is_active })),
    members: ctx.members.map((member) => ({ userId: member.user_id, isActive: member.is_active })),
    jobs: ctx.jobs.map((job) => ({ id: job.id, code: job.code, sortOrder: job.sort_order })),
    usesJobs: ctx.team.uses_jobs,
    exactCoverage: true,
    unavailable: ctx.unavailable,
    config: ctx.config,
    carryIn: ctx.carryIn,
  }
}

export async function validateSchedule(ctx: ScheduleContext): Promise<Violation[]> {
  const rows = await getAssignments(ctx.schedule.id)
  return validateAssignments(toValidateContext(ctx), toDrafts(ctx, rows as Record<string, unknown>[]))
}

export async function runGenerate(ctx: ScheduleContext, actorId: string) {
  if (ctx.schedule.status !== 'draft') throw new HttpError(409, 'สร้างตารางอัตโนมัติได้เฉพาะฉบับร่าง')

  const input: SchedulerInput = {
    days: ctx.days,
    slots: ctx.slots,
    staff: ctx.members.map((m) => ({ userId: m.user_id, key: m.profile.ephis_id ?? m.user_id })),
    unavailable: ctx.unavailable,
    jobs: ctx.jobs.map((j) => ({ id: j.id, code: j.code, sortOrder: j.sort_order })),
    usesJobs: ctx.team.uses_jobs,
    carryIn: ctx.carryIn,
    config: ctx.config,
  }
  const result = generateSchedule(input)
  const jobConfigurationError = result.violations.find((violation) => violation.rule === 'job_coverage')
  if (jobConfigurationError) throw new HttpError(409, jobConfigurationError.message)

  const admin = getAdminClient()
  const rows = result.assignments.map((a) => ({
    work_date: a.date,
    shift_type_id: a.shiftTypeId,
    user_id: a.userId,
    job_id: a.jobId,
    source: 'auto',
  }))
  const expectedVersion = Number((ctx.schedule as Schedule & { assignment_version?: number }).assignment_version ?? 0)
  const { error } = await admin.rpc('shift_replace_schedule_assignments', {
    p_schedule_id: ctx.schedule.id,
    p_expected_version: expectedVersion,
    p_rows: rows,
    p_generated_by: actorId,
    p_config: ctx.config as unknown as Record<string, unknown>,
  })
  if (error) {
    if (error.code === '40001' || error.code === 'P0001') throw new HttpError(409, error.message)
    throw new HttpError(500, error.message)
  }

  return result
}

/** Candidate list for the manual cell editor, sorted by fairness. */
export async function getCandidates(ctx: ScheduleContext, date: string, shiftTypeId: string) {
  if (!ctx.days.some((day) => day.date === date)) throw new HttpError(400, 'วันที่อยู่นอกเดือนของตาราง')
  const slot = ctx.slots.find((s) => s.shiftTypeId === shiftTypeId)
  if (!slot) throw new HttpError(404, 'ไม่พบประเภทเวร')
  const rows = (await getAssignments(ctx.schedule.id)) as Record<string, unknown>[]
  const drafts = toDrafts(ctx, rows)

  const daySet = new Set(ctx.days.map((d) => d.date))
  const knownDates = new Set([
    ...daySet,
    ...ctx.carryIn.regularWorkDates,
    ...(ctx.carryIn.previousKnownDates ?? []),
    ...(ctx.carryIn.futureRegularWorkDates ?? []),
    ...(ctx.carryIn.futureKnownDates ?? []),
    ...Object.values(ctx.carryIn.assignments).flat().map((assignment) => assignment.date),
    ...Object.values(ctx.carryIn.futureAssignments ?? {}).flat().map((assignment) => assignment.date),
  ])
  const monday = mondayOfWeek(date)
  const weekDates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i)
    if (knownDates.has(d)) weekDates.push(d)
  }
  const dayClass = ctx.days.find((d) => d.date === date)?.dayClass ?? 'weekday'
  const required = slot.requiredByDayClass[dayClass] ?? 0
  const jobConfigurationError = ctx.team.uses_jobs && required > 0 && ctx.jobs.length !== required
  const dayClassByDate = new Map(ctx.days.map((day) => [day.date, day.dayClass]))
  const slotByCode = new Map(ctx.slots.map((s) => [s.code, s]))

  return ctx.members.map((member) => {
    const state: PersonState = {
      intervals: [],
      workDates: new Set(),
      monthCount: 0,
      unavailable: new Set(ctx.unavailable[member.user_id] ?? []),
    }
    for (const day of ctx.days) {
      if (day.dayClass === 'weekday' && !state.unavailable.has(day.date)) addRegularWork(state, day.date)
    }
    for (const regularDate of ctx.carryIn.regularWorkDates) {
      if (!state.unavailable.has(regularDate)) addRegularWork(state, regularDate)
    }
    for (const regularDate of ctx.carryIn.futureRegularWorkDates ?? []) {
      if (!state.unavailable.has(regularDate)) addRegularWork(state, regularDate)
    }
    const stats = emptyStats()
    stats.byType = { ...(ctx.carryIn.shiftTypeCounts[member.user_id] ?? {}) }
    stats.byJob = { ...(ctx.carryIn.jobCounts[member.user_id] ?? {}) }
    stats.weekendHoliday = ctx.carryIn.weekendHolidayCounts[member.user_id] ?? 0
    for (const a of drafts) {
      if (a.userId !== member.user_id) continue
      const s = slotByCode.get(a.code)
      if (!s) continue
      addToPerson(state, a.date, s)
      // Keep an invalid stale row visible to overlap/max-shift checks, but an
      // approved leave date still counts as a day off for weekly-rest logic.
      if (state.unavailable.has(a.date)) state.workDates.delete(a.date)
      stats.total += 1
      stats.byType[a.code] = (stats.byType[a.code] ?? 0) + 1
      stats.currentByType[a.code] = (stats.currentByType[a.code] ?? 0) + 1
      if (dayClassByDate.get(a.date) !== 'weekday') stats.weekendHoliday += 1
      if (dayClassByDate.get(a.date) === 'holiday') stats.holiday += 1
    }
    for (const carry of ctx.carryIn.assignments[member.user_id] ?? []) {
      const s = slotByCode.get(carry.code)
      if (s) {
        state.intervals.push(toInterval(carry.date, s))
        if (!state.unavailable.has(carry.date)) state.workDates.add(carry.date)
      }
    }
    for (const carry of ctx.carryIn.futureAssignments?.[member.user_id] ?? []) {
      const s = slotByCode.get(carry.code)
      if (s) {
        state.intervals.push(toInterval(carry.date, s))
        if (!state.unavailable.has(carry.date)) state.workDates.add(carry.date)
      }
    }
    const alreadyInSlot = drafts.some(
      (a) => a.userId === member.user_id && a.date === date && a.shiftTypeId === shiftTypeId,
    )
    const check = required <= 0
      ? ({ ok: false, rule: 'overstaffed', reason: 'เวรประเภทนี้ไม่ได้เปิดในวันดังกล่าว' } as const)
      : jobConfigurationError
        ? ({ ok: false, rule: 'job_coverage', reason: 'จำนวน Job ไม่ตรงจำนวนคนต่อเวร' } as const)
        : alreadyInSlot
      ? ({ ok: false, rule: 'assigned', reason: 'อยู่ในเวรนี้แล้ว' } as const)
      : checkAssignment(state, date, slot, ctx.config, weekDates)
    return {
      userId: member.user_id,
      displayName: member.displayName,
      total: stats.total,
      typeCount: stats.currentByType[slot.code] ?? 0,
      historicalTypeCount: stats.byType[slot.code] ?? 0,
      holiday: stats.holiday,
      weekendHoliday: stats.weekendHoliday,
      ok: check.ok,
      reason: check.ok ? null : check.reason,
      score: fairnessScore(
        stats, slot.code, dayClass, consecutiveWorkDaysBefore(state.workDates, date), ctx.config.weights,
        ctx.carryIn.totalCounts[member.user_id] ?? 0,
      ),
    }
  }).sort((a, b) => {
    const totalDifference = a.total - b.total
    return Number(b.ok) - Number(a.ok)
    || (Math.abs(totalDifference) > 1 ? totalDifference : 0)
    || (dayClass === 'holiday' ? a.holiday - b.holiday : 0)
    || a.typeCount - b.typeCount
    || a.historicalTypeCount - b.historicalTypeCount
    || totalDifference
    || (dayClass === 'weekend' ? a.weekendHoliday - b.weekendHoliday : 0)
    || a.score - b.score
    || a.displayName.localeCompare(b.displayName)
  })
}

/** Full bundle for the roster views. Fetches everything for one team/month
 *  in a single parallel batch — the Supabase project lives in a different
 *  region from the app, so each extra sequential round trip is expensive. */
export async function getScheduleBundle(month: string, teamId: string | null, actor: Actor) {
  assertMonth(month)
  const teams = await getTeams()
  const activeTeams = teams.filter((t) => t.is_active)
  const team = (teamId ? activeTeams.find((t) => t.id === teamId) : activeTeams[0]) ?? activeTeams[0]
  if (!team) throw new HttpError(404, 'ยังไม่มีทีม')

  const dates = datesOfMonth(month)
  const admin = getAdminClient()

  const [shiftTypes, requirements, jobs, holidays, members, scheduleResult] = await Promise.all([
    getShiftTypes(),
    getRequirements(team.id),
    getJobs(team.id),
    getHolidays(dates[0], dates[dates.length - 1]),
    getTeamMembers(team.id),
    admin.from('shift_schedules').select('*').eq('team_id', team.id).eq('month', `${month}-01`).maybeSingle(),
  ])
  const days = classifyDays(dates, holidays)

  let schedule = scheduleResult.data as unknown as Schedule | null
  if (schedule && schedule.status === 'draft' && !actor.isScheduler) schedule = null

  const assignments = schedule ? ((await getAssignments(schedule.id)) as unknown as Assignment[]) : []

  return {
    teams: activeTeams,
    team,
    shiftTypes,
    requirements,
    jobs,
    days,
    holidays,
    members: members.map((m) => ({
      userId: m.user_id,
      displayName: m.displayName,
      fullName: m.profile.name,
      role: m.profile.role,
      ephisId: m.profile.ephis_id,
    })),
    schedule,
    assignments,
    canManage: actor.isScheduler,
    isAdmin: actor.isAdmin,
    me: actor.id,
  }
}

export function assertEditable(schedule: Schedule) {
  if (schedule.status === 'locked') throw new HttpError(409, 'ตารางเวรถูกล็อคแล้ว ไม่สามารถแก้ไข/แลกเวรได้')
}
