import { z } from 'zod'
import { getAdminClient } from '@/lib/supabase/admin'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { readJson, respond } from '@/lib/server/route'
import { writeLineAudit } from '@/lib/server/line-audit'

const DEFAULTS = {
  shift_reminder_enabled: true,
  swap_notification_enabled: true,
  sale_notification_enabled: true,
  daily_summary_enabled: false,
}

const schema = z.object({
  shiftReminderEnabled: z.boolean(),
  swapNotificationEnabled: z.boolean(),
  saleNotificationEnabled: z.boolean(),
  dailySummaryEnabled: z.boolean(),
})

function toClient(row: Record<string, unknown> | null) {
  return {
    shiftReminderEnabled: row?.shift_reminder_enabled !== false,
    swapNotificationEnabled: row?.swap_notification_enabled !== false,
    saleNotificationEnabled: row?.sale_notification_enabled !== false,
    dailySummaryEnabled: row?.daily_summary_enabled === true,
  }
}

export async function GET() {
  return respond(async () => {
    const actor = await requireLineSessionActor()
    const { data, error } = await getAdminClient().from('shift_line_notification_settings')
      .select('shift_reminder_enabled,swap_notification_enabled,sale_notification_enabled,daily_summary_enabled')
      .eq('user_id', actor.id).maybeSingle()
    if (error) throw error
    return toClient((data ?? DEFAULTS) as Record<string, unknown>)
  })
}

export async function PATCH(request: Request) {
  return respond(async () => {
    const actor = await requireLineSessionActor(request, true)
    const body = await readJson(request, schema)
    const { error } = await getAdminClient().from('shift_line_notification_settings').upsert({
      user_id: actor.id,
      shift_reminder_enabled: body.shiftReminderEnabled,
      swap_notification_enabled: body.swapNotificationEnabled,
      sale_notification_enabled: body.saleNotificationEnabled,
      daily_summary_enabled: body.dailySummaryEnabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) throw error
    await writeLineAudit({ actorUserId: actor.id, source: 'line', action: 'notification_preferences_updated', referenceType: 'profile', referenceId: actor.id, newValue: body })
    return body
  })
}
