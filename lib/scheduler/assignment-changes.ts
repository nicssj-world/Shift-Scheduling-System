import { validateAssignments, type ValidateContext } from '@/lib/scheduler/validate'
import type { AssignmentDraft, Violation } from '@/lib/scheduler/types'

export type OwnedAssignmentDraft = AssignmentDraft & { id: string }

/**
 * Return hard-rule violations introduced by changing assignment owners.
 * Existing unrelated violations do not block a swap/sale, but a transfer may
 * not add leave, overlap, rest, >16-hour, max-shift, or weekly-day-off errors.
 */
export function newOwnerChangeViolations(
  ctx: ValidateContext,
  assignments: OwnedAssignmentDraft[],
  changes: Map<string, string>,
): Violation[] {
  const changedUsers = new Set<string>()
  const proposed = assignments.map((assignment) => {
    const nextUserId = changes.get(assignment.id)
    if (!nextUserId) return assignment
    changedUsers.add(assignment.userId)
    changedUsers.add(nextUserId)
    return { ...assignment, userId: nextUserId }
  })

  const relevant = (violation: Violation) => (
    violation.severity === 'error'
    && Boolean(violation.userId)
    && changedUsers.has(violation.userId!)
  )
  const signature = (violation: Violation) => [
    violation.date,
    violation.shiftTypeCode ?? '',
    violation.userId ?? '',
    violation.rule,
    violation.message,
  ].join('|')

  const beforeCounts = new Map<string, number>()
  for (const violation of validateAssignments(ctx, assignments).filter(relevant)) {
    const key = signature(violation)
    beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1)
  }

  const introduced: Violation[] = []
  for (const violation of validateAssignments(ctx, proposed).filter(relevant)) {
    const key = signature(violation)
    const before = beforeCounts.get(key) ?? 0
    if (before > 0) beforeCounts.set(key, before - 1)
    else introduced.push(violation)
  }
  return introduced
}
