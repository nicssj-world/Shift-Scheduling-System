import { z } from 'zod'
import { requireAdmin } from '@/lib/server/auth'
import { writeLineAudit } from '@/lib/server/line-audit'
import { revokeAllLineSessions } from '@/lib/server/line-session'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'

const schema = z.object({ action: z.enum(['disable', 'enable', 'unlink']) })

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await requireAdmin()
    const { action } = await readJson(request, schema)
    const id = (await params).id
    const admin = getAdminClient()
    const { data: account, error: accountError } = await admin
      .from('shift_line_accounts').select('id,user_id,status').eq('id', id).maybeSingle()
    if (accountError || !account) throw new HttpError(404, 'ไม่พบบัญชี LINE')
    if (action === 'enable' && String(account.status) === 'blocked') {
      throw new HttpError(409, 'บัญชีที่บล็อก LINE ไว้ต้องเชื่อมใหม่จาก MINI App')
    }
    const patch = action === 'enable'
      ? { status: 'active', unlinked_at: null, updated_at: new Date().toISOString() }
      : action === 'unlink'
        ? { status: 'disabled', unlinked_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : { status: 'disabled', updated_at: new Date().toISOString() }
    const { data: updated, error } = await admin.from('shift_line_accounts').update(patch).eq('id', id)
      .select('id,user_id,line_user_id,status,linked_at,last_seen_at,unlinked_at').maybeSingle()
    if (error || !updated) throw new HttpError(500, 'แก้ไขบัญชี LINE ไม่สำเร็จ')
    if (action !== 'enable') await revokeAllLineSessions(String(account.user_id))
    await writeLineAudit({ actorUserId: actor.id, source: 'admin', action: `line_account_${action}`, referenceType: 'line_account', referenceId: id, oldValue: { status: account.status }, newValue: { status: updated.status } })
    return { account: updated }
  })
}
