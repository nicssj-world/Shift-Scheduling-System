import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

const actionSchema = z.object({ action: z.enum(['approve', 'reject', 'cancel']) })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireActor()
    const { id } = await params
    const { action } = await readJson(request, actionSchema)
    const admin = getAdminClient()

    const { data, error } = await admin.from('shift_leaves').select('*').eq('id', id).maybeSingle()
    if (error || !data) throw new HttpError(404, 'ไม่พบรายการลา')
    const leave = data as Record<string, unknown>
    const now = new Date().toISOString()

    if (action === 'cancel') {
      const isOwner = String(leave.user_id) === actor.id
      if (!isOwner && !actor.isAdmin && !actor.isManager) throw new HttpError(403, 'ไม่มีสิทธิ์ยกเลิก')
      await admin.from('shift_leaves').update({ status: 'cancelled', decided_by: actor.id, decided_at: now }).eq('id', id)
    } else {
      if (!actor.isAdmin && !actor.isManager) throw new HttpError(403, 'เฉพาะ Admin/Manager อนุมัติวันลาได้')
      if (String(leave.status) !== 'pending') throw new HttpError(409, 'รายการนี้ถูกตัดสินแล้ว')
      await admin.from('shift_leaves').update({
        status: action === 'approve' ? 'approved' : 'rejected',
        decided_by: actor.id,
        decided_at: now,
      }).eq('id', id)
      await notifyUsers([String(leave.user_id)], {
        type: 'leave_decided',
        title: action === 'approve' ? 'คำขอลาของคุณได้รับอนุมัติ' : 'คำขอลาของคุณไม่ได้รับอนุมัติ',
        link: '/leaves',
      })
    }

    const { data: updated } = await admin.from('shift_leaves').select('*').eq('id', id).maybeSingle()
    return { leave: updated }
  })
}
