import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { getSaleSettings } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { readJson, respond } from '@/lib/server/route'
import { applySale } from '@/lib/server/sales'
import { getAdminClient } from '@/lib/supabase/admin'

const actionSchema = z.object({
  action: z.enum(['accept', 'decline', 'approve', 'reject', 'cancel']),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireActor()
    const { id } = await params
    const { action } = await readJson(request, actionSchema)
    const admin = getAdminClient()

    const { data, error } = await admin.from('shift_sale_requests').select('*').eq('id', id).maybeSingle()
    if (error || !data) throw new HttpError(404, 'ไม่พบคำขอขายเวร')
    const sale = data as Record<string, unknown>
    const status = String(sale.status)
    const now = new Date().toISOString()
    const both = [String(sale.seller_id), String(sale.buyer_id)]

    if (action === 'cancel') {
      if (String(sale.seller_id) !== actor.id) throw new HttpError(403, 'ยกเลิกได้เฉพาะผู้ขาย')
      if (!status.startsWith('pending')) throw new HttpError(409, 'คำขอนี้ถูกดำเนินการแล้ว')
      await admin.from('shift_sale_requests').update({ status: 'cancelled' }).eq('id', id)
    } else if (action === 'accept' || action === 'decline') {
      if (String(sale.buyer_id) !== actor.id) throw new HttpError(403, 'เฉพาะผู้ซื้อเท่านั้น')
      if (status !== 'pending_buyer') throw new HttpError(409, 'คำขอนี้ถูกตอบแล้ว')

      if (action === 'decline') {
        await admin.from('shift_sale_requests')
          .update({ status: 'declined', buyer_responded_at: now }).eq('id', id)
        await notifyUsers([String(sale.seller_id)], {
          type: 'sale_declined', title: `${actor.name} ปฏิเสธคำขอขายเวรของคุณ`, link: '/swaps',
        })
      } else {
        const { requiresApproval } = await getSaleSettings()
        if (requiresApproval) {
          await admin.from('shift_sale_requests')
            .update({ status: 'pending_approval', buyer_responded_at: now }).eq('id', id)
          await notifyUsers([String(sale.seller_id)], {
            type: 'sale_accepted', title: `${actor.name} ตอบรับซื้อเวร — รอผู้จัดเวรอนุมัติ`, link: '/swaps',
          })
          // notify schedulers/admin — Manager can no longer approve sales
          const { data: schedulers } = await admin.from('shift_schedulers').select('user_id')
          const { data: admins } = await admin.from('profiles').select('id,role')
            .or('role.eq.Admin,role.eq.admin')
          const approverIds = [
            ...(schedulers ?? []).map((s) => String(s.user_id)),
            ...(admins ?? []).map((m) => String(m.id)),
          ]
          await notifyUsers(approverIds, {
            type: 'sale_pending_approval', title: 'มีคำขอขายเวรรออนุมัติ', link: '/swaps',
          })
        } else {
          await applySale(sale)
          await admin.from('shift_sale_requests')
            .update({ status: 'approved', buyer_responded_at: now, decided_at: now }).eq('id', id)
          await notifyUsers(both, { type: 'sale_approved', title: 'ขายเวรสำเร็จ ตารางเวรถูกปรับแล้ว', link: '/schedule' })
        }
      }
    } else {
      if (!actor.isScheduler) throw new HttpError(403, 'ต้องเป็นผู้จัดเวร')
      if (status !== 'pending_approval') throw new HttpError(409, 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ')
      if (action === 'approve') {
        await applySale(sale)
        await admin.from('shift_sale_requests')
          .update({ status: 'approved', decided_by: actor.id, decided_at: now }).eq('id', id)
        await notifyUsers(both, { type: 'sale_approved', title: 'คำขอขายเวรได้รับอนุมัติ ตารางเวรถูกปรับแล้ว', link: '/schedule' })
      } else {
        await admin.from('shift_sale_requests')
          .update({ status: 'rejected', decided_by: actor.id, decided_at: now }).eq('id', id)
        await notifyUsers(both, { type: 'sale_rejected', title: 'คำขอขายเวรไม่ได้รับอนุมัติ', link: '/swaps' })
      }
    }

    const { data: updated } = await admin.from('shift_sale_requests').select('*').eq('id', id).maybeSingle()
    return { sale: updated }
  })
}
