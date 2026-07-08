import 'server-only'

import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Exchange the two assignments' people. Jobs stay with the slot (the person
 * arriving takes over the job of that cell). Reverts the first update if the
 * second fails (no server-side transaction available via supabase-js).
 */
export async function applySwap(swap: Record<string, unknown>) {
  const admin = getAdminClient()
  const requesterAssignmentId = String(swap.requester_assignment_id)
  const targetAssignmentId = String(swap.target_assignment_id)

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

  const scheduleIds = [...new Set([String(first.schedule_id), String(second.schedule_id)])]
  const { data: schedules } = await admin.from('shift_schedules').select('id,status').in('id', scheduleIds)
  for (const s of schedules ?? []) {
    if (String(s.status) === 'locked') throw new HttpError(409, 'ตารางเวรถูกล็อคแล้ว')
  }

  const { error: firstError } = await admin
    .from('shift_assignments')
    .update({ user_id: String(swap.target_user_id), source: 'swap' })
    .eq('id', requesterAssignmentId)
  if (firstError) throw new HttpError(409, 'คู่แลกมีเวรซ้ำในช่องนั้นอยู่แล้ว')

  const { error: secondError } = await admin
    .from('shift_assignments')
    .update({ user_id: String(swap.requester_id), source: 'swap' })
    .eq('id', targetAssignmentId)
  if (secondError) {
    // revert
    await admin.from('shift_assignments')
      .update({ user_id: String(swap.requester_id), source: 'swap' })
      .eq('id', requesterAssignmentId)
    throw new HttpError(409, 'ผู้ขอมีเวรซ้ำในช่องของคู่แลกอยู่แล้ว')
  }
}
