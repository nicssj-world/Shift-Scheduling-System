import 'server-only'

import { datesOfMonth } from '@/lib/dates'
import { generateSchedule } from '@/lib/scheduler/engine'
import { addRegularWork, addToPerson, checkAssignment, toInterval, type PersonState } from '@/lib/scheduler/constraints'
import { consecutiveWorkDaysBefore, emptyStats, fairnessScore } from '@/lib/scheduler/fairness'
import type { AssignmentDraft, SchedulerInput, Violation } from '@/lib/scheduler/types'
import { validateAssignments } from '@/lib/scheduler/validate'
import {
  buildCarryIn, buildDays, buildSlots, classifyDays, getAssignments, getHolidays, getJobs, getRequirements,
  getSchedule, getSchedulerConfig, getShiftTypes, getTeam, getTeamMembers, getTeams, getUnavailableDates,
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

  const [shiftTypes, requirements, jobs, holidays, members, config] = await Promise.all([
    getShiftTypes(), getRequirements(teamId), getJobs(teamId),
    getHolidays(dates[0], dates[dates.length - 1]),
    getTeamMembers(teamId), getSchedulerConfig(),
  ])
  const days = classifyDays(dates, holidays)

  const [unavailable, carryIn] = await Promise.all([
    getUnavailableDates(members.map((m) => m.user_id), dates[0], dates[dates.length - 1]),
    buildCarryIn(teamId, month, shiftTypes, jobs),
  ])

  return {
    schedule: schedule as Schedule, teamId, month, members,
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

export async function validateSchedule(ctx: ScheduleContext): Promise<Violation[]> {
  const rows = await getAssignments(ctx.schedule.id)
  return validateAssignments(
    { days: ctx.days, slots: ctx.slots, unavailable: ctx.unavailable, config: ctx.config, carryIn: ctx.carryIn },
    toDrafts(ctx, rows as Record<string, unknown>[]),
  )
}

export async function runGenerate(ctx: ScheduleContext, actorId: string) {
  if (ctx.schedule.status === 'locked') throw new HttpError(409, 'ตารางถูกล็อคแล้ว')

  const input: SchedulerInput = {
    days: ctx.days,
    slots: ctx.slots,
    staff: ctx.members.map((m) => ({ userId: m.user_id, key: m.profile.ephis_id ?? m.user_id })),
    unavailable: ctx.unavailable,
    jobs: ctx.jobs.map((j) => ({ id: j.id, code: j.code, sortOrder: j.sort_order })),
    carryIn: ctx.carryIn,
    config: ctx.config,
  }
  const result = generateSchedule(input)

  const admin = getAdminClient()
  const { error: deleteError } = await admin.from('shift_assignments').delete().eq('schedule_id', ctx.schedule.id)
  if (deleteError) throw new HttpError(500, deleteError.message)

  const rows = result.assignments.map((a) => ({
    schedule_id: ctx.schedule.id,
    work_date: a.date,
    shift_type_id: a.shiftTypeId,
    user_id: a.userId,
    job_id: a.jobId,
    source: 'auto',
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('shift_assignments').insert(rows.slice(i, i + 500))
    if (error) throw new HttpError(500, error.message)
  }
  await admin.from('shift_schedules').update({
    generated_at: new Date().toISOString(),
    generated_by: actorId,
    config: ctx.config as unknown as Record<string, unknown>,
  }).eq('id', ctx.schedule.id)

  return result
}

/** Candidate list for the manual cell editor, sorted by fairness. */
export async function getCandidates(ctx: ScheduleContext, date: string, shiftTypeId: string) {
  const slot = ctx.slots.find((s) => s.shiftTypeId === shiftTypeId)
  if (!slot) throw new HttpError(404, 'ไม่พบประเภทเวร')
  const rows = (await getAssignments(ctx.schedule.id)) as Record<string, unknown>[]
  const drafts = toDrafts(ctx, rows)

  const daySet = new Set(ctx.days.map((d) => d.date))
  const monday = mondayOfWeek(date)
  const weekDates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i)
    if (daySet.has(d)) weekDates.push(d)
  }
  const dayClass = ctx.days.find((d) => d.date === date)?.dayClass ?? 'weekday'
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
    for (const regularDate of ctx.carryIn.regularWorkDates) addRegularWork(state, regularDate)
    const stats = emptyStats()
    stats.byType = { ...(ctx.carryIn.shiftTypeCounts[member.user_id] ?? {}) }
    stats.byJob = { ...(ctx.carryIn.jobCounts[member.user_id] ?? {}) }
    stats.weekendHoliday = ctx.carryIn.weekendHolidayCounts[member.user_id] ?? 0
    for (const a of drafts) {
      if (a.userId !== member.user_id) continue
      const s = slotByCode.get(a.code)
      if (!s) continue
      addToPerson(state, a.date, s)
      stats.total += 1
      stats.byType[a.code] = (stats.byType[a.code] ?? 0) + 1
      if (dayClassByDate.get(a.date) !== 'weekday') stats.weekendHoliday += 1
    }
    for (const carry of ctx.carryIn.assignments[member.user_id] ?? []) {
      const s = slotByCode.get(carry.code)
      if (s) {
        state.intervals.push(toInterval(carry.date, s))
        state.workDates.add(carry.date)
      }
    }
    const alreadyInSlot = drafts.some(
      (a) => a.userId === member.user_id && a.date === date && a.shiftTypeId === shiftTypeId,
    )
    const check = alreadyInSlot
      ? ({ ok: false, rule: 'assigned', reason: 'อยู่ในเวรนี้แล้ว' } as const)
      : checkAssignment(state, date, slot, ctx.config, weekDates)
    return {
      userId: member.user_id,
      displayName: member.displayName,
      total: stats.total,
      ok: check.ok,
      reason: check.ok ? null : check.reason,
      score: fairnessScore(
        stats, slot.code, dayClass, consecutiveWorkDaysBefore(state.workDates, date), ctx.config.weights,
        ctx.carryIn.totalCounts[member.user_id] ?? 0,
      ),
    }
  }).sort((a, b) => Number(b.ok) - Number(a.ok) || a.total - b.total || a.score - b.score || a.displayName.localeCompare(b.displayName))
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
