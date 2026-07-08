import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { getSwapSettings } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { readJson, respond } from '@/lib/server/route'
import { applySwap } from '@/lib/server/swaps'
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

    const { data, error } = await admin.from('shift_swap_requests').select('*').eq('id', id).maybeSingle()
    if (error || !data) throw new HttpError(404, 'ไม่พบคำขอแลกเวร')
    const swap = data as Record<string, unknown>
    const status = String(swap.status)
    const now = new Date().toISOString()
    const both = [String(swap.requester_id), String(swap.target_user_id)]

    if (action === 'cancel') {
      if (String(swap.requester_id) !== actor.id) throw new HttpError(403, 'ยกเลิกได้เฉพาะผู้ขอ')
      if (!status.startsWith('pending')) throw new HttpError(409, 'คำขอนี้ถูกดำเนินการแล้ว')
      await admin.from('shift_swap_requests').update({ status: 'cancelled' }).eq('id', id)
    } else if (action === 'accept' || action === 'decline') {
      if (String(swap.target_user_id) !== actor.id) throw new HttpError(403, 'เฉพาะคู่แลกเท่านั้น')
      if (status !== 'pending_counterpart') throw new HttpError(409, 'คำขอนี้ถูกตอบแล้ว')

      if (action === 'decline') {
        await admin.from('shift_swap_requests')
          .update({ status: 'declined', counterpart_responded_at: now }).eq('id', id)
        await notifyUsers([String(swap.requester_id)], {
          type: 'swap_declined', title: `${actor.name} ปฏิเสธคำขอแลกเวรของคุณ`, link: '/swaps',
        })
      } else {
        const { requiresApproval } = await getSwapSettings()
        if (requiresApproval) {
          await admin.from('shift_swap_requests')
            .update({ status: 'pending_approval', counterpart_responded_at: now }).eq('id', id)
          await notifyUsers([String(swap.requester_id)], {
            type: 'swap_accepted', title: `${actor.name} ตอบรับคำขอแลกเวร — รอผู้จัดเวรอนุมัติ`, link: '/swaps',
          })
          // notify schedulers/admin — Manager can no longer approve swaps
          const { data: schedulers } = await admin.from('shift_schedulers').select('user_id')
          const { data: admins } = await admin.from('profiles').select('id,role')
            .or('role.eq.Admin,role.eq.admin')
          const approverIds = [
            ...(schedulers ?? []).map((s) => String(s.user_id)),
            ...(admins ?? []).map((m) => String(m.id)),
          ]
          await notifyUsers(approverIds, {
            type: 'swap_pending_approval', title: 'มีคำขอแลกเวรรออนุมัติ', link: '/swaps',
          })
        } else {
          await applySwap(swap)
          await admin.from('shift_swap_requests')
            .update({ status: 'approved', counterpart_responded_at: now, decided_at: now }).eq('id', id)
          await notifyUsers(both, { type: 'swap_approved', title: 'แลกเวรสำเร็จ ตารางเวรถูกปรับแล้ว', link: '/schedule' })
        }
      }
    } else {
      // approve / reject by scheduler
      if (!actor.isScheduler) throw new HttpError(403, 'ต้องเป็นผู้จัดเวร')
      if (status !== 'pending_approval') throw new HttpError(409, 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ')
      if (action === 'approve') {
        await applySwap(swap)
        await admin.from('shift_swap_requests')
          .update({ status: 'approved', decided_by: actor.id, decided_at: now }).eq('id', id)
        await notifyUsers(both, { type: 'swap_approved', title: 'คำขอแลกเวรได้รับอนุมัติ ตารางเวรถูกปรับแล้ว', link: '/schedule' })
      } else {
        await admin.from('shift_swap_requests')
          .update({ status: 'rejected', decided_by: actor.id, decided_at: now }).eq('id', id)
        await notifyUsers(both, { type: 'swap_rejected', title: 'คำขอแลกเวรไม่ได้รับอนุมัติ', link: '/swaps' })
      }
    }

    const { data: updated } = await admin.from('shift_swap_requests').select('*').eq('id', id).maybeSingle()
    return { swap: updated }
  })
}
