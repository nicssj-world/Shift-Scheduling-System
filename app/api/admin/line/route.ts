import { z } from 'zod'
import { requireAdmin } from '@/lib/server/auth'
import { getLineSettings } from '@/lib/server/line-config'
import { writeLineAudit } from '@/lib/server/line-audit'
import { getAdminClient } from '@/lib/supabase/admin'
import { readJson, respond } from '@/lib/server/route'

const settingsSchema = z.object({
  enabled: z.boolean().optional(), swapEnabled: z.boolean().optional(), saleEnabled: z.boolean().optional(), openSaleEnabled: z.boolean().optional(),
  dailyRosterEnabled: z.boolean().optional(), personalReminderEnabled: z.boolean().optional(), showPhoneInDailyRoster: z.boolean().optional(),
  dailyRosterHour: z.number().int().min(0).max(23).optional(), personalReminderHour: z.number().int().min(0).max(23).optional(),
}).strict()
const groupSchema = z.object({
  groupId: z.string().uuid(), isApproved: z.boolean().optional(), isActive: z.boolean().optional(), dailyRosterEnabled: z.boolean().optional(), showPhoneInDailyRoster: z.boolean().optional(),
}).refine((body) => Object.keys(body).some((key) => key !== 'groupId'), 'ไม่มีข้อมูลที่ต้องแก้ไข')

export async function GET() {
  return respond(async () => {
    await requireAdmin()
    const admin = getAdminClient()
    const [{ data: accounts, error: accountError }, { data: groups, error: groupError }, { data: logs, error: logError }, { data: webhookEvents, error: webhookError }, settings] = await Promise.all([
      admin.from('shift_line_accounts').select('id,user_id,line_user_id,status,linked_at,last_seen_at,unlinked_at').order('linked_at', { ascending: false }).limit(500),
      admin.from('shift_line_groups').select('id,line_group_id,name,group_type,is_approved,is_active,daily_roster_enabled,show_phone_in_daily_roster,created_at,updated_at').order('created_at', { ascending: false }).limit(200),
      admin.from('shift_line_message_logs').select('id,recipient_type,line_user_id,line_group_id,message_type,status,attempts,error_code,created_at,sent_at').order('created_at', { ascending: false }).limit(100),
      admin.from('shift_line_webhook_events').select('id,webhook_event_id,event_type,line_user_id,line_group_id,status,attempts,error_code,created_at,processed_at').order('created_at', { ascending: false }).limit(100),
      getLineSettings(),
    ])
    if (accountError || groupError || logError || webhookError) throw new Error('ไม่สามารถอ่านสถานะ LINE ได้')
    const userIds = [...new Set((accounts ?? []).map((row) => String(row.user_id)))]
    const { data: profiles } = userIds.length > 0 ? await admin.from('profiles').select('id,name,role,dept').in('id', userIds) : { data: [] }
    const profileById = new Map((profiles ?? []).map((row) => [String(row.id), { name: String(row.name ?? ''), role: String(row.role ?? ''), dept: row.dept ? String(row.dept) : null }]))
    return { settings, accounts: (accounts ?? []).map((row) => ({ ...row, profile: profileById.get(String(row.user_id)) ?? null })), groups: groups ?? [], logs: logs ?? [], webhookEvents: webhookEvents ?? [] }
  })
}

export async function PUT(request: Request) {
  return respond(async () => {
    const actor = await requireAdmin()
    const patch = await readJson(request, settingsSchema)
    const current = await getLineSettings()
    const next = { ...current, ...patch }
    const { error } = await getAdminClient().from('shift_settings').upsert({ key: 'line', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw error
    await writeLineAudit({ actorUserId: actor.id, source: 'admin', action: 'line_settings_updated', referenceType: 'shift_settings', referenceId: 'line', oldValue: current, newValue: next })
    return { settings: next }
  })
}

export async function PATCH(request: Request) {
  return respond(async () => {
    const actor = await requireAdmin()
    const body = await readJson(request, groupSchema)
    const columns: Record<string, string> = {
      isApproved: 'is_approved',
      isActive: 'is_active',
      dailyRosterEnabled: 'daily_roster_enabled',
      showPhoneInDailyRoster: 'show_phone_in_daily_roster',
    }
    const changes = Object.fromEntries(Object.entries(body)
      .filter(([key]) => key !== 'groupId')
      .map(([key, value]) => [columns[key] ?? key, value]))
    if (changes.is_approved === false) changes.is_active = false
    if (changes.is_active === true) {
      const { data: current } = await getAdminClient().from('shift_line_groups').select('is_approved').eq('id', body.groupId).maybeSingle()
      if (!current?.is_approved && changes.is_approved !== true) changes.is_active = false
    }
    const { data, error } = await getAdminClient().from('shift_line_groups').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', body.groupId).select('*').maybeSingle()
    if (error || !data) throw new Error('ไม่พบกลุ่ม LINE')
    await writeLineAudit({ actorUserId: actor.id, source: 'admin', action: 'line_group_updated', referenceType: 'shift_line_group', referenceId: body.groupId, newValue: changes })
    return { group: data }
  })
}
