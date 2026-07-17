import 'server-only'

import { bangkokDateString } from '@/lib/dates'
import { assertOwnerChangesValid } from '@/lib/server/assignment-changes'
import { HttpError } from '@/lib/server/errors'
import { throwRequestRpcError } from '@/lib/server/request-rpc'
import { getAdminClient } from '@/lib/supabase/admin'

type ApplySwapOptions = {
  expectedStatus: string
  actorId: string
  decidedBy?: string
  respondedAt?: string
}

/** Validate against a roster version, then let one RPC atomically exchange
 * both owners and approve the request. A single retry revalidates if another
 * request changed the same roster between validation and the transaction. */
export async function applySwap(swap: Record<string, unknown>, options: ApplySwapOptions) {
  const admin = getAdminClient()
  const requesterAssignmentId = String(swap.requester_assignment_id)
  const targetAssignmentId = String(swap.target_assignment_id)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: assignments, error } = await admin
      .from('shift_assignments')
      .select('id,user_id,schedule_id,work_date,shift_type_id')
      .in('id', [requesterAssignmentId, targetAssignmentId])
    if (error) throw new HttpError(500, error.message)
    const first = assignments?.find((a) => String(a.id) === requesterAssignmentId)
    const second = assignments?.find((a) => String(a.id) === targetAssignmentId)
    if (!first || !second) throw new HttpError(409, 'เวรที่ขอแลกถูกลบไปแล้ว')
    if (String(first.user_id) !== String(swap.requester_id) || String(second.user_id) !== String(swap.target_user_id)) {
      throw new HttpError(409, 'เวรมีการเปลี่ยนแปลงหลังจากส่งคำขอ กรุณาสร้างคำขอใหม่')
    }
    const today = bangkokDateString()
    if (String(first.work_date) < today || String(second.work_date) < today) {
      throw new HttpError(409, 'ไม่สามารถแลกเวรที่ผ่านไปแล้ว')
    }

    const scheduleIds = [...new Set([String(first.schedule_id), String(second.schedule_id)])]
    const { data: schedules, error: schedulesError } = await admin
      .from('shift_schedules').select('id,status,assignment_version').in('id', scheduleIds)
    if (schedulesError || !schedules || schedules.length !== scheduleIds.length) throw new HttpError(409, 'ไม่พบตารางเวรที่เกี่ยวข้อง')
    for (const schedule of schedules) {
      if (String(schedule.status) !== 'published') throw new HttpError(409, 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่')
    }

    await assertOwnerChangesValid([
      { assignmentId: requesterAssignmentId, scheduleId: String(first.schedule_id), newUserId: String(swap.target_user_id) },
      { assignmentId: targetAssignmentId, scheduleId: String(second.schedule_id), newUserId: String(swap.requester_id) },
    ])

    const scheduleVersion = Number(schedules[0].assignment_version)
    const { data, error: applyError } = await admin.rpc('shift_apply_swap_request', {
      p_request_id: String(swap.id),
      p_expected_status: options.expectedStatus,
      p_expected_schedule_version: scheduleVersion,
      p_actor_id: options.actorId,
      p_decided_by: options.decidedBy ?? null,
      p_responded_at: options.respondedAt ?? null,
    })
    if (!applyError) return data
    if (applyError.code === '40001' && attempt === 0) continue
    throwRequestRpcError(applyError, 'แลกเวรไม่สำเร็จ')
  }
  throw new HttpError(409, 'ตารางเวรมีการเปลี่ยนแปลงพร้อมกัน กรุณาลองใหม่')
}
