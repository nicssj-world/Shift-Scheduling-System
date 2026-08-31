import { z } from 'zod'
import { requireScheduler } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { readJson, respond } from '@/lib/server/route'
import {
  assertEditable, loadScheduleContext, toDrafts, toValidateContext, validateSchedule,
} from '@/lib/server/schedule-service'
import { getAdminClient } from '@/lib/supabase/admin'
import { thaiShortDate } from '@/lib/dates'
import type { AssignmentDraft, Violation } from '@/lib/scheduler/types'
import { validateAssignments, violationKey } from '@/lib/scheduler/validate'

const setSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftTypeId: z.string().uuid(),
  userId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  /** when replacing a person in an existing cell */
  replaceAssignmentId: z.string().uuid().optional(),
})

const jobSchema = z.object({
  assignmentId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
})

const STRUCTURAL_RULES = new Set([
  'date_out_of_range', 'inactive_shift', 'invalid_shift_type', 'non_team_member',
  'invalid_job', 'duplicate_assignment', 'job_coverage', 'overstaffed',
])

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireScheduler()
    const { id } = await params
    const body = await readJson(request, setSchema)
    const ctx = await loadScheduleContext(id)
    assertEditable(ctx.schedule)

    const rows = await getAssignmentsForSchedule(id)
    const drafts = toDrafts(ctx, rows)
    const changedUsers = [body.userId]
    let operation: 'insert' | 'replace' = 'insert'
    let oldIndex = -1

    if (body.replaceAssignmentId) {
      oldIndex = rows.findIndex((row) => String(row.id) === body.replaceAssignmentId)
      if (oldIndex < 0) throw new HttpError(404, 'ไม่พบเวรที่ต้องการแทนที่ในตารางนี้')
      const old = rows[oldIndex]
      if (String(old.work_date) !== body.workDate || String(old.shift_type_id) !== body.shiftTypeId) {
        throw new HttpError(409, 'assignment ที่ต้องการแทนที่ไม่ตรงกับช่องตารางปัจจุบัน')
      }
      changedUsers.push(String(old.user_id))
      operation = 'replace'
    }

    const proposed = [...drafts]
    const existingJobId = oldIndex >= 0 && rows[oldIndex].job_id ? String(rows[oldIndex].job_id) : null
    // `undefined` means the caller omitted the field (preserve a replaced
    // assignment's Job); an explicit null is an intentional request to clear
    // it for a non-Job team.
    const nextJobId = body.jobId === undefined ? existingJobId : body.jobId
    const nextDraft: AssignmentDraft = {
      date: body.workDate,
      shiftTypeId: body.shiftTypeId,
      code: ctx.shiftTypes.find((type) => type.id === body.shiftTypeId)?.code ?? '?',
      userId: body.userId,
      jobId: nextJobId,
    }
    if (oldIndex >= 0) proposed[oldIndex] = nextDraft
    else proposed.push(nextDraft)

    await assertProposedRosterAllowed(ctx, drafts, proposed)
    const version = currentVersion(ctx)
    const { error } = await getAdminClient().rpc('shift_apply_manual_assignment', {
      p_schedule_id: id,
      p_expected_version: version,
      p_operation: operation,
      p_assignment_id: body.replaceAssignmentId ?? null,
      p_work_date: body.workDate,
      p_shift_type_id: body.shiftTypeId,
      p_user_id: body.userId,
      p_job_id: nextJobId,
      p_actor_id: actor.id,
      p_expected_status: ctx.schedule.status,
    })
    if (error) throw assignmentMutationError(error)

    const violations = await validateSchedule(ctx)
    if (ctx.schedule.status === 'published') {
      await notifyUsers([...new Set(changedUsers)], {
        type: 'schedule_changed',
        title: `มีการเปลี่ยนแปลงตารางเวรวันที่ ${thaiShortDate(body.workDate)}`,
        body: ctx.shiftTypes.find((type) => type.id === body.shiftTypeId)?.name_th,
        link: `/schedule?team=${ctx.teamId}&month=${ctx.month}`,
      })
    }
    return { ok: true, violations }
  })
}

const removeSchema = z.object({ assignmentId: z.string().uuid() })

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireScheduler()
    const { id } = await params
    const body = await readJson(request, removeSchema)
    const ctx = await loadScheduleContext(id)
    assertEditable(ctx.schedule)

    const rows = await getAssignmentsForSchedule(id)
    const index = rows.findIndex((row) => String(row.id) === body.assignmentId)
    if (index < 0) throw new HttpError(404, 'ไม่พบเวรนี้ในตาราง')
    const drafts = toDrafts(ctx, rows)
    const proposed = drafts.filter((_draft, draftIndex) => draftIndex !== index)
    const old = rows[index]
    await assertProposedRosterAllowed(ctx, drafts, proposed)

    const { error } = await getAdminClient().rpc('shift_apply_manual_assignment', {
      p_schedule_id: id,
      p_expected_version: currentVersion(ctx),
      p_operation: 'delete',
      p_assignment_id: body.assignmentId,
      p_work_date: null,
      p_shift_type_id: null,
      p_user_id: null,
      p_job_id: null,
      p_actor_id: actor.id,
      p_expected_status: ctx.schedule.status,
    })
    if (error) throw assignmentMutationError(error)

    const violations = await validateSchedule(ctx)
    if (ctx.schedule.status === 'published') {
      await notifyUsers([String(old.user_id)], {
        type: 'schedule_changed',
        title: `เวรของคุณวันที่ ${thaiShortDate(String(old.work_date))} ถูกยกเลิก`,
        link: `/schedule?team=${ctx.teamId}&month=${ctx.month}`,
      })
    }
    return { ok: true, violations }
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireScheduler()
    const { id } = await params
    const body = await readJson(request, jobSchema)
    const ctx = await loadScheduleContext(id)
    assertEditable(ctx.schedule)
    const rows = await getAssignmentsForSchedule(id)
    const index = rows.findIndex((row) => String(row.id) === body.assignmentId)
    if (index < 0) throw new HttpError(404, 'ไม่พบเวรนี้ในตาราง')
    const drafts = toDrafts(ctx, rows)
    const proposed = [...drafts]
    proposed[index] = { ...proposed[index], jobId: body.jobId }
    await assertProposedRosterAllowed(ctx, drafts, proposed)

    const { error } = await getAdminClient().rpc('shift_apply_manual_assignment', {
      p_schedule_id: id,
      p_expected_version: currentVersion(ctx),
      p_operation: 'set_job',
      p_assignment_id: body.assignmentId,
      p_work_date: null,
      p_shift_type_id: null,
      p_user_id: null,
      p_job_id: body.jobId,
      p_actor_id: actor.id,
      p_expected_status: ctx.schedule.status,
    })
    if (error) throw assignmentMutationError(error)

    const violations = await validateSchedule(ctx)
    return { ok: true, violations }
  })
}

async function getAssignmentsForSchedule(scheduleId: string) {
  const { data, error } = await getAdminClient()
    .from('shift_assignments').select('*').eq('schedule_id', scheduleId).order('work_date')
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as Record<string, unknown>[]
}

async function assertProposedRosterAllowed(
  ctx: Awaited<ReturnType<typeof loadScheduleContext>>,
  before: AssignmentDraft[],
  proposed: AssignmentDraft[],
) {
  const validationContext = toValidateContext(ctx)
  const afterViolations = validateAssignments(validationContext, proposed)
  const beforeViolations = validateAssignments(validationContext, before)
  const structural = afterViolations.filter((violation) => violation.severity === 'error' && STRUCTURAL_RULES.has(violation.rule))
  // Drafts must never persist a newly malformed assignment. A published
  // roster may already contain a legacy violation; for that state we compare
  // before/after below and reject only a newly introduced or worsened hard
  // error, as required for safe emergency edits.
  if (ctx.schedule.status !== 'published') {
    if (structural.length > 0) throw new HttpError(409, `แก้ไขไม่ได้: ${structural[0].message}`)
    return
  }

  const beforeByKey = new Map<string, Violation[]>()
  for (const violation of beforeViolations.filter((item) => item.severity === 'error')) {
    const key = violationKey(violation)
    beforeByKey.set(key, [...(beforeByKey.get(key) ?? []), violation])
  }
  const counts = new Map<string, number>()
  for (const [key, list] of beforeByKey) counts.set(key, list.length)
  const introduced = afterViolations.filter((violation) => {
    if (violation.severity !== 'error') return false
    const key = violationKey(violation)
    const remaining = counts.get(key) ?? 0
    if (remaining > 0) {
      counts.set(key, remaining - 1)
      const previous = beforeByKey.get(key)?.[beforeByKey.get(key)!.length - remaining]
      return Boolean(previous && worsenedViolation(violation, previous))
    }
    return true
  })
  if (introduced.length > 0) throw new HttpError(409, `แก้ไขไม่ได้: ${introduced[0].message}`)
}

/**
 * Stable-key comparison is enough for most rules. Coverage and monthly
 * limits carry a numeric magnitude in their message, so compare that value
 * as well: improving an existing deficit is allowed, while increasing an
 * existing overage/limit breach is not.
 */
function worsenedViolation(after: Violation, before: Violation) {
  if (after.message === before.message) return false
  if (after.rule === 'understaffed' || after.rule === 'overstaffed') {
    const next = coverageActual(after.message)
    const previous = coverageActual(before.message)
    if (next !== null && previous !== null) {
      return after.rule === 'understaffed' ? next < previous : next > previous
    }
  }
  if (after.rule === 'max_shifts') {
    const next = trailingNumber(after.message)
    const previous = trailingNumber(before.message)
    if (next !== null && previous !== null) return next > previous
  }
  // A changed non-quantified message is conservatively treated as a
  // regression; unchanged violations are explicitly allowed.
  return true
}

function coverageActual(message: string) {
  const match = /(\d+)\/(\d+)/.exec(message)
  return match ? Number(match[1]) : null
}

function trailingNumber(message: string) {
  const match = /\((\d+)\)\s*$/.exec(message)
  return match ? Number(match[1]) : null
}

function currentVersion(ctx: Awaited<ReturnType<typeof loadScheduleContext>>) {
  return Number((ctx.schedule as typeof ctx.schedule & { assignment_version?: number }).assignment_version ?? 0)
}

function assignmentMutationError(error: { code?: string; message: string }) {
  if (error.code === '40001' || error.code === 'P0001' || error.code === '23505') return new HttpError(409, error.message)
  return new HttpError(500, error.message)
}
