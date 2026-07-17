import 'server-only'

import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'

/** Return assignments reserved by any pending swap/sale request. */
export async function getPendingAssignmentIds(assignmentIds: string[]) {
  const ids = [...new Set(assignmentIds)]
  const requestedIds = new Set(ids)
  const blocked = new Set<string>()
  if (ids.length === 0) return blocked
  const admin = getAdminClient()

  // The reservation table contains active requests only, so this is one small
  // query even after years of permanent request history. Intersect in memory
  // to avoid putting hundreds of candidate UUIDs into a PostgREST URL.
  const { data: reservations, error } = await admin
    .from('shift_assignment_reservations').select('assignment_id')
  if (error) throw new HttpError(500, error.message)
  for (const reservation of reservations ?? []) {
    const assignmentId = String(reservation.assignment_id)
    if (requestedIds.has(assignmentId)) blocked.add(assignmentId)
  }
  return blocked
}

/** Prevent one assignment from being committed to multiple pending swap/sale
 * requests. Without this guard, the first approval changes ownership and all
 * later approvals fail as stale requests. */
export async function assertAssignmentsHaveNoPendingRequest(assignmentIds: string[]) {
  const blocked = await getPendingAssignmentIds(assignmentIds)
  if (blocked.size > 0) throw new HttpError(409, 'เวรนี้อยู่ในคำขอที่รอดำเนินการอยู่แล้ว')
}
