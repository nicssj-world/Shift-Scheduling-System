import 'server-only'

import { bangkokDateString, thaiShortDate } from '@/lib/dates'
import { getAdminClient } from '@/lib/supabase/admin'
import { assertOwnerChangesValid } from '@/lib/server/assignment-changes'
import { getSaleSettings, getShiftTypes, getSwapSettings } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { assertAssignmentsHaveNoPendingRequest } from '@/lib/server/request-conflicts'
import { throwRequestRpcError } from '@/lib/server/request-rpc'
import { transitionRequestStatus } from '@/lib/server/request-status'
import { applySale } from '@/lib/server/sales'
import { applySwap } from '@/lib/server/swaps'
import { getLineSettings } from '@/lib/server/line-config'
import { notifyMappedLineGroups } from '@/lib/server/line-notify'
import { expireOpenSaleListings } from '@/lib/server/open-sales'
import type { Actor } from '@/lib/types'

export function mutationId(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value
  if (row && typeof row === 'object' && 'id' in row) return String((row as { id?: unknown }).id ?? '')
  return typeof value === 'string' ? value : ''
}

async function approverIds() {
  const admin = getAdminClient()
  const [{ data: schedulers }, { data: admins }] = await Promise.all([
    admin.from('shift_schedulers').select('user_id'),
    admin.from('profiles').select('id,role').or('role.eq.Admin,role.eq.admin'),
  ])
  return [...new Set([
    ...(schedulers ?? []).map((row) => String(row.user_id)),
    ...(admins ?? []).map((row) => String(row.id)),
  ])]
}

export async function createSwapRequest(actor: Actor, input: {
  requesterAssignmentId: string
  targetAssignmentId: string
  reason?: string
}) {
  const admin = getAdminClient()
  const { data: assignments, error } = await admin.from('shift_assignments')
    .select('id,user_id,work_date,shift_type_id,schedule_id')
    .in('id', [input.requesterAssignmentId, input.targetAssignmentId])
  if (error) throw new HttpError(500, error.message)
  const mine = assignments?.find((row) => String(row.id) === input.requesterAssignmentId)
  const theirs = assignments?.find((row) => String(row.id) === input.targetAssignmentId)
  if (!mine || !theirs) throw new HttpError(404, 'ไม่พบเวรที่เลือก')
  if (String(mine.user_id) !== actor.id) throw new HttpError(403, 'เลือกได้เฉพาะเวรของตัวเอง')
  if (String(theirs.user_id) === actor.id) throw new HttpError(400, 'เลือกเวรของเพื่อนร่วมงานเป็นคู่แลก')
  const today = bangkokDateString()
  if (String(mine.work_date) < today || String(theirs.work_date) < today) throw new HttpError(400, 'เลือกได้เฉพาะเวรวันนี้หรือในอนาคต')
  if (String(mine.schedule_id) !== String(theirs.schedule_id)) throw new HttpError(400, 'แลกเวรได้เฉพาะภายในตารางเดือนเดียวกัน')
  const { data: schedule, error: scheduleError } = await admin.from('shift_schedules')
    .select('id,status,team_id').eq('id', String(mine.schedule_id)).maybeSingle()
  if (scheduleError || !schedule) throw new HttpError(409, 'ไม่พบตารางเวรที่เกี่ยวข้อง')
  if (String(schedule.status) === 'locked') throw new HttpError(409, 'ตารางเวรถูกล็อคแล้ว ไม่สามารถขอแลกเวรได้')
  if (String(schedule.status) !== 'published') throw new HttpError(409, 'แลกได้เฉพาะตารางที่เผยแพร่แล้ว')
  await assertAssignmentsHaveNoPendingRequest([String(mine.id), String(theirs.id)])
  await assertOwnerChangesValid([
    { assignmentId: String(mine.id), scheduleId: String(mine.schedule_id), newUserId: String(theirs.user_id) },
    { assignmentId: String(theirs.id), scheduleId: String(theirs.schedule_id), newUserId: actor.id },
  ])
  const { data: swap, error: insertError } = await admin.rpc('shift_create_swap_request', {
    p_requester_assignment_id: input.requesterAssignmentId,
    p_target_assignment_id: input.targetAssignmentId,
    p_requester_id: actor.id,
    p_target_user_id: String(theirs.user_id),
    p_reason: input.reason ?? null,
  })
  if (insertError) throwRequestRpcError(insertError, 'สร้างคำขอแลกเวรไม่สำเร็จ')
  await notifyUsers([String(theirs.user_id)], {
    type: 'swap_requested', title: `${actor.name} ขอแลกเวรกับคุณ`,
    body: `เวรวันที่ ${thaiShortDate(String(mine.work_date))} ↔ ${thaiShortDate(String(theirs.work_date))}`,
    link: '/swaps',
  })
  return { swap, targetUserId: String(theirs.user_id), requesterDate: String(mine.work_date), targetDate: String(theirs.work_date) }
}

export async function createDirectSaleRequest(actor: Actor, input: {
  assignmentIds: string[]
  buyerId: string
  reason?: string
}) {
  if (input.buyerId === actor.id) throw new HttpError(400, 'เลือกผู้ซื้อที่ไม่ใช่ตัวเอง')
  const admin = getAdminClient()
  const { data: assignments, error } = await admin.from('shift_assignments')
    .select('id,user_id,schedule_id,work_date,shift_type_id').in('id', input.assignmentIds)
  if (error) throw new HttpError(500, error.message)
  if (!assignments || assignments.length !== input.assignmentIds.length) throw new HttpError(404, 'ไม่พบเวรที่เลือกบางรายการ')
  if (assignments.some((row) => String(row.user_id) !== actor.id)) throw new HttpError(403, 'เลือกได้เฉพาะเวรของตัวเอง')
  const today = bangkokDateString()
  if (assignments.some((row) => String(row.work_date) < today)) throw new HttpError(400, 'เลือกได้เฉพาะเวรวันนี้หรือในอนาคต')
  const scheduleIds = [...new Set(assignments.map((row) => String(row.schedule_id)))]
  if (scheduleIds.length !== 1) throw new HttpError(400, 'ขายเวรได้เฉพาะภายในตารางเดือนเดียวกันต่อคำขอ')
  const { data: schedule } = await admin.from('shift_schedules').select('id,status,team_id').eq('id', scheduleIds[0]).maybeSingle()
  if (!schedule) throw new HttpError(409, 'ไม่พบตารางเวรที่เกี่ยวข้อง')
  if (String(schedule.status) === 'locked') throw new HttpError(409, 'ตารางเวรถูกล็อคแล้ว ไม่สามารถขายเวรได้')
  if (String(schedule.status) !== 'published') throw new HttpError(409, 'ขายได้เฉพาะเวรในตารางที่เผยแพร่แล้ว')
  const { data: membership } = await admin.from('shift_team_members').select('id')
    .eq('team_id', String(schedule.team_id)).eq('user_id', input.buyerId).eq('is_active', true).maybeSingle()
  if (!membership) throw new HttpError(400, 'ผู้ซื้อต้องเป็นสมาชิกทีมเดียวกัน')
  await assertAssignmentsHaveNoPendingRequest(assignments.map((row) => String(row.id)))
  await assertOwnerChangesValid(assignments.map((row) => ({ assignmentId: String(row.id), scheduleId: String(row.schedule_id), newUserId: input.buyerId })))
  const { data: sale, error: insertError } = await admin.rpc('shift_create_sale_request', {
    p_assignment_ids: assignments.map((row) => String(row.id)), p_seller_id: actor.id,
    p_buyer_id: input.buyerId, p_reason: input.reason ?? null,
  })
  if (insertError) throwRequestRpcError(insertError, 'สร้างคำขอขายเวรไม่สำเร็จ')
  await notifyUsers([input.buyerId], {
    type: 'sale_requested', title: `${actor.name} เสนอขายเวรให้คุณ ${assignments.length} เวร`,
    body: `เริ่มวันที่ ${thaiShortDate(String([...assignments].sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)))[0].work_date))}`,
    link: '/swaps',
  })
  return { sale, buyerId: input.buyerId }
}

export async function createOpenSaleRequest(
  actor: Actor,
  input: { assignmentIds: string[]; reason?: string },
  channel: 'web' | 'line' = 'line',
) {
  const saleSettings = await getSaleSettings()
  if (!saleSettings.openEnabled) throw new HttpError(403, 'ระบบยังไม่เปิดตลาดเวรเปิดขาย')
  if (channel === 'line') {
    const settings = await getLineSettings()
    if (!settings.enabled || !settings.saleEnabled || !settings.openSaleEnabled) throw new HttpError(403, 'การประกาศขายเวรยังไม่เปิดใช้งาน')
  }
  await expireOpenSaleListings()
  const admin = getAdminClient()
  const { data: assignments, error } = await admin.from('shift_assignments')
    .select('id,user_id,schedule_id,work_date,shift_type_id').in('id', input.assignmentIds)
  if (error) throw new HttpError(500, error.message)
  if (!assignments || assignments.length !== input.assignmentIds.length) throw new HttpError(404, 'ไม่พบเวรที่เลือกบางรายการ')
  if (assignments.some((row) => String(row.user_id) !== actor.id)) throw new HttpError(403, 'เลือกได้เฉพาะเวรของตัวเอง')
  const scheduleIds = [...new Set(assignments.map((row) => String(row.schedule_id)))]
  const { data: schedules, error: scheduleError } = await admin.from('shift_schedules').select('id,team_id,status').in('id', scheduleIds)
  if (scheduleError || !schedules || schedules.length !== scheduleIds.length) throw new HttpError(409, 'ไม่พบตารางเวรที่เกี่ยวข้อง')
  const teamBySchedule = new Map(schedules.map((schedule) => [String(schedule.id), String(schedule.team_id)]))
  const teamIds = [...new Set(schedules.map((schedule) => String(schedule.team_id)))]
  if (teamIds.length !== 1) throw new HttpError(400, 'ประกาศหนึ่งรายการต้องอยู่ในทีมเดียวกัน')
  if (schedules.some((schedule) => String(schedule.status) !== 'published')) throw new HttpError(409, 'ประกาศได้เฉพาะตารางเวรที่เผยแพร่แล้ว')
  const scopes = assignments.map((assignment) => ({
    teamId: teamBySchedule.get(String(assignment.schedule_id)) ?? '',
    shiftTypeId: String(assignment.shift_type_id),
  })).filter((scope) => scope.teamId)
  const shiftTypes = await getShiftTypes()
  const codeByTypeId = new Map(shiftTypes.map((type) => [String(type.id), type.code]))
  const { data: sale, error: rpcError } = await admin.rpc('shift_create_open_sale_request', {
    p_assignment_ids: input.assignmentIds, p_seller_id: actor.id, p_reason: input.reason ?? null,
  })
  if (rpcError) throwRequestRpcError(rpcError, 'สร้างประกาศขายเวรไม่สำเร็จ')
  const saleId = mutationId(sale)
  await notifyMappedLineGroups(scopes, {
    type: 'sale_opened',
    title: `${actor.name} ประกาศขายเวรใน LINE`,
    body: `${assignments.length} เวร · ${[...assignments]
      .sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)))
      .map((row) => `${String(row.work_date)} ${codeByTypeId.get(String(row.shift_type_id)) ?? ''}`.trim())
      .join(', ')}`,
    link: '/line/open-sales',
    referenceType: 'shift_sale_request',
    referenceId: saleId,
    dedupeKey: `sale-opened:${saleId}`,
    category: 'sale',
  })
  return { sale, assignmentCount: assignments.length }
}

export async function transitionSwap(actor: Actor, swapId: string, action: 'accept' | 'decline' | 'approve' | 'reject' | 'cancel') {
  const admin = getAdminClient()
  const { data, error } = await admin.from('shift_swap_requests').select('*').eq('id', swapId).maybeSingle()
  if (error || !data) throw new HttpError(404, 'ไม่พบคำขอแลกเวร')
  const swap = data as Record<string, unknown>
  const status = String(swap.status)
  const now = new Date().toISOString()
  const both = [String(swap.requester_id), String(swap.target_user_id)]
  if (action === 'cancel') {
    if (String(swap.requester_id) !== actor.id) throw new HttpError(403, 'ยกเลิกได้เฉพาะผู้ขอ')
    if (!status.startsWith('pending')) throw new HttpError(409, 'คำขอนี้ถูกดำเนินการแล้ว')
    await transitionRequestStatus('shift_swap_requests', swapId, status, { status: 'cancelled' }, actor.id)
    await notifyUsers([String(swap.target_user_id)], {
      type: 'swap_cancelled', title: `${actor.name} ยกเลิกคำขอแลกเวร`, link: '/swaps',
    })
  } else if (action === 'accept' || action === 'decline') {
    if (String(swap.target_user_id) !== actor.id) throw new HttpError(403, 'เฉพาะคู่แลกเท่านั้น')
    if (status !== 'pending_counterpart') throw new HttpError(409, 'คำขอนี้ถูกตอบแล้ว')
    if (action === 'decline') {
      await transitionRequestStatus('shift_swap_requests', swapId, status, { status: 'declined', counterpart_responded_at: now }, actor.id)
      await notifyUsers([String(swap.requester_id)], { type: 'swap_declined', title: `${actor.name} ปฏิเสธคำขอแลกเวรของคุณ`, link: '/swaps' })
    } else if ((await getSwapSettings()).requiresApproval) {
      await transitionRequestStatus('shift_swap_requests', swapId, status, { status: 'pending_approval', counterpart_responded_at: now }, actor.id)
      await notifyUsers([String(swap.requester_id), ...(await approverIds())], { type: 'swap_accepted', title: `${actor.name} ตอบรับคำขอแลกเวร — รอผู้จัดเวรอนุมัติ`, link: '/swaps' })
    } else {
      await applySwap(swap, { expectedStatus: status, actorId: actor.id, respondedAt: now })
      await notifyUsers(both, { type: 'swap_approved', title: 'แลกเวรสำเร็จ ตารางเวรถูกปรับแล้ว', link: '/schedule' })
    }
  } else {
    if (!actor.isScheduler) throw new HttpError(403, 'ต้องเป็นผู้จัดเวร')
    if (status !== 'pending_approval') throw new HttpError(409, 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ')
    if (action === 'approve') {
      await applySwap(swap, { expectedStatus: status, actorId: actor.id, decidedBy: actor.id })
      await notifyUsers(both, { type: 'swap_approved', title: 'คำขอแลกเวรได้รับอนุมัติ ตารางเวรถูกปรับแล้ว', link: '/schedule' })
    } else {
      await transitionRequestStatus('shift_swap_requests', swapId, status, { status: 'rejected', decided_by: actor.id, decided_at: now }, actor.id)
      await notifyUsers(both, { type: 'swap_rejected', title: 'คำขอแลกเวรไม่ได้รับอนุมัติ', link: '/swaps' })
    }
  }
  const { data: updated } = await admin.from('shift_swap_requests').select('*').eq('id', swapId).maybeSingle()
  return updated
}

async function claimOpenSale(actor: Actor, saleId: string, sale: Record<string, unknown>) {
  await expireOpenSaleListings()
  const admin = getAdminClient()
  const { data: items, error: itemError } = await admin.from('shift_sale_items')
    .select('assignment_id,status').eq('sale_request_id', saleId).eq('status', 'active')
  if (itemError) throw new HttpError(500, itemError.message)
  if (!items?.length) throw new HttpError(409, 'ประกาศนี้หมดอายุแล้ว กรุณาโหลดรายการใหม่')
  const assignmentIds = items.map((item) => String(item.assignment_id))
  const { data: assignments, error: assignmentError } = await admin.from('shift_assignments')
    .select('id,schedule_id,user_id,work_date,shift_type_id').in('id', assignmentIds)
  if (assignmentError) throw new HttpError(500, assignmentError.message)
  if (!assignments || assignments.length !== assignmentIds.length) throw new HttpError(409, 'เวรบางรายการถูกลบหรือเปลี่ยนแปลงแล้ว')
  if (assignments.some((item) => String(item.user_id) !== String(sale.seller_id))) {
    throw new HttpError(409, 'เจ้าของเวรมีการเปลี่ยนแปลง กรุณาโหลดรายการใหม่')
  }
  const today = bangkokDateString()
  if (assignments.some((item) => String(item.work_date) < today)) {
    throw new HttpError(409, 'ประกาศนี้มีเวรหมดอายุแล้ว กรุณาโหลดรายการใหม่')
  }
  const scheduleIds = [...new Set(assignments.map((item) => String(item.schedule_id)))]
  const { data: schedules, error: scheduleError } = await admin.from('shift_schedules')
    .select('id,team_id,assignment_version,status').in('id', scheduleIds)
  if (scheduleError || !schedules || schedules.length !== scheduleIds.length) {
    throw new HttpError(409, 'ไม่พบตารางเวรที่เกี่ยวข้อง')
  }
  if (schedules.some((schedule) => String(schedule.status) !== 'published')) {
    throw new HttpError(409, 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่')
  }
  const teamIds = [...new Set(schedules.map((schedule) => String(schedule.team_id)))]
  if (teamIds.length !== 1) throw new HttpError(409, 'ประกาศนี้มีมากกว่าหนึ่งทีม')
  const { data: membership, error: membershipError } = await admin.from('shift_team_members')
    .select('id').eq('team_id', teamIds[0]).eq('user_id', actor.id).eq('is_active', true).maybeSingle()
  if (membershipError) throw new HttpError(500, membershipError.message)
  if (!membership) throw new HttpError(409, 'ผู้รับต้องเป็นสมาชิกทีมของเวรนี้')
  await assertOwnerChangesValid(assignments.map((item) => ({
    assignmentId: String(item.id), scheduleId: String(item.schedule_id), newUserId: actor.id,
  })))
  const expectedScheduleVersions = Object.fromEntries(
    schedules.map((schedule) => [String(schedule.id), Number(schedule.assignment_version)]),
  )
  const settings = await getSaleSettings()
  if (!settings.openEnabled) throw new HttpError(403, 'ระบบยังไม่เปิดตลาดเวรเปิดขาย')
  const { data: claimedData, error: claimError } = await admin.rpc('shift_claim_open_sale', {
    p_request_id: saleId,
    p_buyer_id: actor.id,
    p_expected_schedule_versions: expectedScheduleVersions,
    p_requires_approval: settings.requiresApproval,
    p_actor_id: actor.id,
  })
  if (claimError) throwRequestRpcError(claimError, 'รับเวรไม่สำเร็จ')
  const claimed = (Array.isArray(claimedData) ? claimedData[0] : claimedData) as { status?: string } | null
  const count = assignments.length
  const dedupeKey = (userId: string) => `sale-claim:${saleId}:${userId}`
  if (String(claimed?.status) === 'approved') {
    await notifyUsers([String(sale.seller_id), actor.id], {
      type: 'sale_approved',
      title: `รับเวรสำเร็จ ${count} เวร`,
      body: `${actor.name} รับเวรของคุณแล้ว`,
      link: '/schedule',
      dedupeKey,
      referenceType: 'shift_sale_request',
      referenceId: saleId,
    })
  } else {
    await notifyUsers([String(sale.seller_id), actor.id, ...(await approverIds())], {
      type: 'sale_accepted',
      title: `${actor.name} ขอรับเวร ${count} เวร`,
      body: 'รอผู้จัดเวรอนุมัติ',
      link: '/swaps',
      dedupeKey,
      referenceType: 'shift_sale_request',
      referenceId: saleId,
    })
  }
  return claimed
}

export async function transitionSale(
  actor: Actor,
  saleId: string,
  action: 'accept' | 'decline' | 'approve' | 'reject' | 'cancel' | 'claim',
  channel: 'web' | 'line' = 'web',
) {
  const admin = getAdminClient()
  const { data, error } = await admin.from('shift_sale_requests').select('*').eq('id', saleId).maybeSingle()
  if (error || !data) throw new HttpError(404, 'ไม่พบคำขอขายเวร')
  const sale = data as Record<string, unknown>
  const status = String(sale.status)
  const saleMode = String(sale.sale_mode ?? 'direct')
  const now = new Date().toISOString()
  const buyerId = sale.buyer_id ? String(sale.buyer_id) : null
  if (action === 'claim' && saleMode === 'open') return claimOpenSale(actor, saleId, sale)
  if (action === 'claim') throw new HttpError(409, 'การรับเวรแบบตลาดใช้ได้เฉพาะประกาศรับคนแรก')
  /* Legacy single-schedule claim path retained only as source documentation;
   * all open claims return through claimOpenSale above. */
  /*
  if (action === 'claim') {
    if (saleMode !== 'open' || status !== 'open') throw new HttpError(409, 'เวรนี้มีผู้รับแล้ว')
    if (String(sale.seller_id) === actor.id) throw new HttpError(400, 'ผู้ขายรับเวรของตัวเองไม่ได้')
    const items = await admin.from('shift_sale_items').select('assignment_id').eq('sale_request_id', saleId)
    if (items.error || !items.data?.length) throw new HttpError(409, 'ประกาศนี้ไม่มีเวร')
    const assignmentIds = items.data.map((item) => String(item.assignment_id))
    const { data: assignments } = await admin.from('shift_assignments').select('id,schedule_id,user_id,work_date,shift_type_id').in('id', assignmentIds)
    if (!assignments || assignments.length !== assignmentIds.length) throw new HttpError(409, 'เวรบางรายการถูกลบไปแล้ว')
    if (assignments.some((item) => String(item.user_id) !== String(sale.seller_id))) throw new HttpError(409, 'เจ้าของเวรมีการเปลี่ยนแปลงแล้ว')
    const scheduleIds = [...new Set(assignments.map((item) => String(item.schedule_id)))]
    if (scheduleIds.length !== 1) throw new HttpError(409, 'ประกาศขายเวรข้ามตารางไม่ได้')
    const { data: schedule } = await admin.from('shift_schedules').select('id,team_id,assignment_version,status').eq('id', scheduleIds[0]).maybeSingle()
    if (!schedule || String(schedule.status) !== 'published') throw new HttpError(409, 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่')
    const { data: membership } = await admin.from('shift_team_members').select('id').eq('team_id', String(schedule.team_id)).eq('user_id', actor.id).eq('is_active', true).maybeSingle()
    if (!membership) throw new HttpError(403, 'คุณไม่มีสิทธิ์รับเวรจากทีมนี้')
    await assertOwnerChangesValid(assignments.map((item) => ({ assignmentId: String(item.id), scheduleId: String(item.schedule_id), newUserId: actor.id })))
    const settings = await getSaleSettings()
    const { data: claimedData, error: claimError } = await admin.rpc('shift_claim_open_sale', {
      p_request_id: saleId, p_buyer_id: actor.id, p_expected_schedule_version: Number(schedule.assignment_version),
      p_requires_approval: settings.requiresApproval, p_actor_id: actor.id,
    })
    if (claimError) throwRequestRpcError(claimError, 'รับเวรไม่สำเร็จ')
    const claimed = (Array.isArray(claimedData) ? claimedData[0] : claimedData) as { status?: string } | null
    if (String(claimed?.status) === 'approved') {
      await notifyUsers([String(sale.seller_id), actor.id], { type: 'sale_approved', title: 'รับเวรสำเร็จ ตารางเวรถูกปรับแล้ว', link: '/line/my-shifts' })
    } else {
      await notifyUsers([String(sale.seller_id), actor.id, ...(await approverIds())], { type: 'sale_accepted', title: `${actor.name} ขอรับเวรของคุณ — รอผู้จัดเวรอนุมัติ`, link: '/swaps' })
    }
    return claimed
  }
  }
  */
  const both = [String(sale.seller_id), ...(buyerId ? [buyerId] : [])]
  if (action === 'cancel') {
    if (String(sale.seller_id) !== actor.id) throw new HttpError(403, 'ยกเลิกได้เฉพาะผู้ขาย')
    if (!['open', 'pending_buyer', 'pending_approval'].includes(status)) throw new HttpError(409, 'คำขอนี้ถูกดำเนินการแล้ว')
    await transitionRequestStatus('shift_sale_requests', saleId, status, { status: 'cancelled' }, actor.id)
    if (buyerId) await notifyUsers([buyerId], {
      type: 'sale_cancelled', title: `${actor.name} ยกเลิกการขายเวร`, link: '/swaps',
    })
  } else if (action === 'accept' || action === 'decline') {
    if (!buyerId || buyerId !== actor.id) throw new HttpError(403, 'เฉพาะผู้ซื้อเท่านั้น')
    if (status !== 'pending_buyer') throw new HttpError(409, 'คำขอนี้ถูกตอบแล้ว')
    if (action === 'decline') {
      await transitionRequestStatus('shift_sale_requests', saleId, status, { status: 'declined', buyer_responded_at: now }, actor.id)
      await notifyUsers([String(sale.seller_id)], { type: 'sale_declined', title: `${actor.name} ปฏิเสธคำขอขายเวรของคุณ`, link: '/swaps' })
    } else if ((await getSaleSettings()).requiresApproval) {
      await transitionRequestStatus('shift_sale_requests', saleId, status, { status: 'pending_approval', buyer_responded_at: now }, actor.id)
      await notifyUsers([String(sale.seller_id), ...(await approverIds())], { type: 'sale_accepted', title: `${actor.name} ตอบรับซื้อเวร — รอผู้จัดเวรอนุมัติ`, link: '/swaps' })
    } else {
      await applySale(sale, { expectedStatus: status, actorId: actor.id, respondedAt: now })
      await notifyUsers(both, { type: 'sale_approved', title: 'ขายเวรสำเร็จ ตารางเวรถูกปรับแล้ว', link: '/schedule' })
    }
  } else {
    if (!actor.isScheduler) throw new HttpError(403, 'ต้องเป็นผู้จัดเวร')
    if (saleMode === 'open' && action === 'reject' && status === 'pending_approval') {
      const { error: reopenError } = await admin.rpc('shift_reopen_open_sale', { p_request_id: saleId, p_actor_id: actor.id })
      if (reopenError) throwRequestRpcError(reopenError, 'ไม่สามารถเปิดประกาศขายเวรอีกครั้งได้')
      await notifyUsers([String(sale.seller_id), ...(buyerId ? [buyerId] : [])], { type: 'sale_reopened', title: 'ประกาศขายเวรถูกเปิดรับอีกครั้ง', link: '/line/sell' })
    } else {
      if (status !== 'pending_approval') throw new HttpError(409, 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ')
      if (action === 'approve') {
        await applySale(sale, { expectedStatus: status, actorId: actor.id, decidedBy: actor.id })
        await notifyUsers(both, { type: 'sale_approved', title: 'คำขอขายเวรได้รับอนุมัติ ตารางเวรถูกปรับแล้ว', link: '/schedule' })
      } else {
        await transitionRequestStatus('shift_sale_requests', saleId, status, { status: 'rejected', decided_by: actor.id, decided_at: now }, actor.id)
        await notifyUsers(both, { type: 'sale_rejected', title: 'คำขอขายเวรไม่ได้รับอนุมัติ', link: '/swaps' })
      }
    }
  }
  const { data: updated } = await admin.from('shift_sale_requests').select('*').eq('id', saleId).maybeSingle()
  return updated
}
