import 'server-only'

import { newOwnerChangeViolations, type OwnedAssignmentDraft } from '@/lib/scheduler/assignment-changes'
import { getAssignments } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { loadScheduleContext, toDrafts } from '@/lib/server/schedule-service'

export type AssignmentOwnerChange = {
  assignmentId: string
  scheduleId: string
  newUserId: string
}

/** Re-check hard scheduling rules against the proposed swap/sale before any
 * database mutation. Called again at approval time because the roster may
 * have changed while the request was pending. */
export async function assertOwnerChangesValid(changes: AssignmentOwnerChange[]) {
  const bySchedule = new Map<string, AssignmentOwnerChange[]>()
  for (const change of changes) {
    bySchedule.set(change.scheduleId, [...(bySchedule.get(change.scheduleId) ?? []), change])
  }

  for (const [scheduleId, scheduleChanges] of bySchedule) {
    const ctx = await loadScheduleContext(scheduleId)
    const rows = await getAssignments(scheduleId)
    const drafts = toDrafts(ctx, rows)
    const assignments: OwnedAssignmentDraft[] = drafts.map((draft, index) => ({
      ...draft,
      id: String(rows[index].id),
    }))
    const changeMap = new Map(scheduleChanges.map((change) => [change.assignmentId, change.newUserId]))
    const violations = newOwnerChangeViolations(
      { days: ctx.days, slots: ctx.slots, unavailable: ctx.unavailable, config: ctx.config, carryIn: ctx.carryIn },
      assignments,
      changeMap,
    )
    if (violations.length > 0) {
      throw new HttpError(409, `ทำรายการไม่ได้: ${violations[0].message}`)
    }
  }
}
