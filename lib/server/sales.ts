import 'server-only'

import { bangkokDateString } from '@/lib/dates'
import { assertOwnerChangesValid } from '@/lib/server/assignment-changes'
import { HttpError } from '@/lib/server/errors'
import { throwRequestRpcError } from '@/lib/server/request-rpc'
import { getAdminClient } from '@/lib/supabase/admin'

type ApplySaleOptions = {
  expectedStatus: string
  actorId: string
  decidedBy?: string
  respondedAt?: string
}

/**
 * Transfer every assignment in the sale from seller to buyer — one-way,
 * unlike a swap. The seller's total shift count drops, the buyer's rises by
 * the number of items sold (lifetime fairness carry-in picks this up
 * automatically since it just counts current shift_assignments.user_id
 * rows).
 */
export async function applySale(sale: Record<string, unknown>, options: ApplySaleOptions) {
  const admin = getAdminClient()
  const saleId = String(sale.id)
  const sellerId = String(sale.seller_id)
  const buyerId = String(sale.buyer_id)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: items, error: itemsError } = await admin
      .from('shift_sale_items').select('assignment_id').eq('sale_request_id', saleId)
    if (itemsError) throw new HttpError(500, itemsError.message)
    const assignmentIds = (items ?? []).map((item) => String(item.assignment_id))
    if (assignmentIds.length === 0) throw new HttpError(409, 'ไม่มีเวรในคำขอนี้')

    const { data: assignments, error } = await admin
      .from('shift_assignments')
      .select('id,user_id,schedule_id,work_date,shift_type_id')
      .in('id', assignmentIds)
    if (error) throw new HttpError(500, error.message)
    if (!assignments || assignments.length !== assignmentIds.length) throw new HttpError(409, 'เวรบางรายการถูกลบไปแล้ว')
    if (assignments.some((assignment) => String(assignment.user_id) !== sellerId)) {
      throw new HttpError(409, 'เวรมีการเปลี่ยนแปลงหลังจากส่งคำขอ กรุณาสร้างคำขอใหม่')
    }
    const today = bangkokDateString()
    if (assignments.some((assignment) => String(assignment.work_date) < today)) {
      throw new HttpError(409, 'ไม่สามารถขายเวรที่ผ่านไปแล้ว')
    }

    const scheduleIds = [...new Set(assignments.map((assignment) => String(assignment.schedule_id)))]
    const { data: schedules, error: schedulesError } = await admin
      .from('shift_schedules').select('id,status,team_id,assignment_version').in('id', scheduleIds)
    if (schedulesError || !schedules || schedules.length !== scheduleIds.length) throw new HttpError(409, 'ไม่พบตารางเวรที่เกี่ยวข้อง')
    for (const schedule of schedules) {
      if (String(schedule.status) !== 'published') throw new HttpError(409, 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่')
    }
    const teamIds = [...new Set(schedules.map((schedule) => String(schedule.team_id)))]
    if (teamIds.length !== 1) throw new HttpError(409, 'เวรที่ขายต้องอยู่ในทีมเดียวกัน')
    const { data: buyerMembership, error: membershipError } = await admin
      .from('shift_team_members').select('id')
      .eq('team_id', teamIds[0]).eq('user_id', buyerId).eq('is_active', true).maybeSingle()
    if (membershipError || !buyerMembership) throw new HttpError(409, 'ผู้ซื้อไม่ได้เป็นสมาชิกทีมนี้แล้ว')

    await assertOwnerChangesValid(assignments.map((assignment) => ({
      assignmentId: String(assignment.id),
      scheduleId: String(assignment.schedule_id),
      newUserId: buyerId,
    })))

    const { data, error: applyError } = await admin.rpc('shift_apply_sale_request', {
      p_request_id: saleId,
      p_expected_status: options.expectedStatus,
      p_expected_schedule_version: Number(schedules[0].assignment_version),
      p_actor_id: options.actorId,
      p_decided_by: options.decidedBy ?? null,
      p_responded_at: options.respondedAt ?? null,
    })
    if (!applyError) return data
    if (applyError.code === '40001' && attempt === 0) continue
    throwRequestRpcError(applyError, 'โอนเวรไม่สำเร็จ')
  }
  throw new HttpError(409, 'ตารางเวรมีการเปลี่ยนแปลงพร้อมกัน กรุณาลองใหม่')
}
