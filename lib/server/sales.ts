import 'server-only'

import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Transfer every assignment in the sale from seller to buyer — one-way,
 * unlike a swap. The seller's total shift count drops, the buyer's rises by
 * the number of items sold (lifetime fairness carry-in picks this up
 * automatically since it just counts current shift_assignments.user_id
 * rows).
 */
export async function applySale(sale: Record<string, unknown>) {
  const admin = getAdminClient()
  const saleId = String(sale.id)
  const sellerId = String(sale.seller_id)
  const buyerId = String(sale.buyer_id)

  const { data: items, error: itemsError } = await admin
    .from('shift_sale_items').select('assignment_id').eq('sale_request_id', saleId)
  if (itemsError) throw new HttpError(500, itemsError.message)
  const assignmentIds = (items ?? []).map((i) => String(i.assignment_id))
  if (assignmentIds.length === 0) throw new HttpError(409, 'ไม่มีเวรในคำขอนี้')

  const { data: assignments, error } = await admin
    .from('shift_assignments')
    .select('id,user_id,schedule_id,work_date,shift_type_id')
    .in('id', assignmentIds)
  if (error) throw new HttpError(500, error.message)
  if (!assignments || assignments.length !== assignmentIds.length) {
    throw new HttpError(409, 'เวรบางรายการถูกลบไปแล้ว')
  }
  if (assignments.some((a) => String(a.user_id) !== sellerId)) {
    throw new HttpError(409, 'เวรมีการเปลี่ยนแปลงหลังจากส่งคำขอ กรุณาสร้างคำขอใหม่')
  }

  const scheduleIds = [...new Set(assignments.map((a) => String(a.schedule_id)))]
  const { data: schedules } = await admin.from('shift_schedules').select('id,status').in('id', scheduleIds)
  for (const s of schedules ?? []) {
    if (String(s.status) === 'locked') throw new HttpError(409, 'ตารางเวรถูกล็อคแล้ว')
  }

  // buyer must not already hold a shift at the same (date, shift type)
  const { data: buyerRows } = await admin
    .from('shift_assignments')
    .select('work_date,shift_type_id')
    .eq('user_id', buyerId)
    .in('schedule_id', scheduleIds)
  const buyerKeys = new Set((buyerRows ?? []).map((r) => `${r.work_date}|${r.shift_type_id}`))
  for (const a of assignments) {
    if (buyerKeys.has(`${a.work_date}|${a.shift_type_id}`)) {
      throw new HttpError(409, `ผู้ซื้อมีเวรวันที่ ${a.work_date} อยู่แล้ว ไม่สามารถรับซื้อซ้ำได้`)
    }
  }

  const { error: updateError } = await admin
    .from('shift_assignments')
    .update({ user_id: buyerId, source: 'sale' })
    .in('id', assignmentIds)
  if (updateError) throw new HttpError(409, 'โอนเวรไม่สำเร็จ อาจมีเวรซ้ำในช่องของผู้ซื้อ')
}
