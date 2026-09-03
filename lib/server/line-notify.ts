import 'server-only'

import { getAdminClient } from '@/lib/supabase/admin'
import { getLineSettings } from '@/lib/server/line-config'
import { resolveMappedLineGroupIds, type LineGroupScope } from '@/lib/server/line-group-mapping'
import { lineAppUrl, pushLineMessage, redactLineError } from '@/lib/server/line-client'

type NotificationCategory = 'swap' | 'sale' | 'reminder' | 'daily'
export type LineNotification = {
  type: string
  title: string
  body?: string
  link?: string
  messages?: Record<string, unknown>[]
  dedupeKey?: string | ((userId: string) => string)
  referenceType?: string
  referenceId?: string
  category?: NotificationCategory
}

function categoryFor(type: string): NotificationCategory {
  if (type.includes('swap')) return 'swap'
  if (type.includes('sale')) return 'sale'
  if (type.includes('daily')) return 'daily'
  return 'reminder'
}

function linePath(path: string) {
  if (path.startsWith('/line')) return path
  if (path === '/schedule' || path.startsWith('/schedule?')) return path.replace('/schedule', '/line/schedule')
  if (path === '/swaps' || path.startsWith('/swaps?')) return path.replace('/swaps', '/line/requests')
  if (path === '/sales/open' || path.startsWith('/sales/open?')) return path.replace('/sales/open', '/line/open-sales')
  if (path === '/line/open-sales' || path.startsWith('/line/open-sales?')) return path
  if (path === '/notifications' || path.startsWith('/notifications?')) return path.replace('/notifications', '/line/requests')
  return path
}

function messagePayload(payload: LineNotification) {
  if (payload.messages?.length) return payload.messages
  const lines = [payload.title, payload.body].filter(Boolean)
  if (payload.link) lines.push(`เปิดดูรายละเอียด: ${lineAppUrl(linePath(payload.link))}`)
  return [{ type: 'text', text: lines.join('\n').slice(0, 4_900) }]
}

/** Queue LINE messages after the core in-app notification has committed. All
 * failures are intentionally swallowed; a LINE outage must never roll back a
 * shift or request mutation. */
export async function notifyLineUsers(userIds: string[], payload: LineNotification) {
  try {
    const settings = await getLineSettings()
    if (!settings.enabled) return
    const unique = [...new Set(userIds)].filter(Boolean)
    if (unique.length === 0) return
    const category = payload.category ?? categoryFor(payload.type)
    const admin = getAdminClient()
    const [{ data: accounts, error: accountError }, { data: preferences, error: preferenceError }] = await Promise.all([
      admin.from('shift_line_accounts').select('user_id,line_user_id,status').in('user_id', unique).eq('status', 'active'),
      admin.from('shift_line_notification_settings').select('user_id,shift_reminder_enabled,swap_notification_enabled,sale_notification_enabled,daily_summary_enabled').in('user_id', unique),
    ])
    if (accountError || preferenceError) return
    const preferenceByUser = new Map((preferences ?? []).map((row) => [String(row.user_id), row]))
    const rows = (accounts ?? []).filter((account) => {
      const pref = preferenceByUser.get(String(account.user_id))
      if (!pref) return true
      if (category === 'swap') return pref.swap_notification_enabled !== false
      if (category === 'sale') return pref.sale_notification_enabled !== false
      if (category === 'daily') return pref.daily_summary_enabled === true
      return pref.shift_reminder_enabled !== false
    }).map((account) => ({
      recipient_type: 'user',
      line_user_id: String(account.line_user_id),
      message_type: payload.type,
      reference_type: payload.referenceType ?? null,
      reference_id: payload.referenceId ?? null,
      dedupe_key: typeof payload.dedupeKey === 'function'
        ? payload.dedupeKey(String(account.user_id))
        : payload.dedupeKey ? `${payload.dedupeKey}:${String(account.user_id)}` : null,
      status: 'queued',
      payload: messagePayload(payload),
      next_attempt_at: new Date().toISOString(),
    }))
    if (rows.length > 0) await admin.from('shift_line_message_logs').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  } catch (error) {
    console.error('LINE notification queue failed', redactLineError(error))
  }
}

export async function queueLineGroupMessage(lineGroupId: string, payload: LineNotification) {
  try {
    const settings = await getLineSettings()
    if (!settings.enabled || !settings.dailyRosterEnabled) return
    const admin = getAdminClient()
    const { data: group } = await admin.from('shift_line_groups').select('line_group_id,is_active,is_approved,daily_roster_enabled').eq('line_group_id', lineGroupId).maybeSingle()
    if (!group || group.is_active !== true || group.is_approved !== true || group.daily_roster_enabled !== true) return
    await admin.from('shift_line_message_logs').upsert({
      recipient_type: 'group', line_group_id: lineGroupId, message_type: payload.type,
      reference_type: payload.referenceType ?? null, reference_id: payload.referenceId ?? null,
      dedupe_key: typeof payload.dedupeKey === 'function'
        ? payload.dedupeKey(lineGroupId)
        : payload.dedupeKey ? `${payload.dedupeKey}:${lineGroupId}` : null,
      status: 'queued', payload: messagePayload(payload), next_attempt_at: new Date().toISOString(),
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  } catch (error) { console.error('LINE group notification queue failed', redactLineError(error)) }
}

/** Queue a non-roster announcement to every approved, active group. */
export async function notifyApprovedLineGroups(payload: LineNotification) {
  try {
    const settings = await getLineSettings()
    if (!settings.enabled) return
    const { data: groups, error } = await getAdminClient().from('shift_line_groups')
      .select('line_group_id').eq('is_active', true).eq('is_approved', true)
    if (error) return
    const rows = (groups ?? []).map((group) => ({
      recipient_type: 'group', line_group_id: String(group.line_group_id), message_type: payload.type,
      reference_type: payload.referenceType ?? null, reference_id: payload.referenceId ?? null,
      dedupe_key: typeof payload.dedupeKey === 'function'
        ? payload.dedupeKey(String(group.line_group_id))
        : payload.dedupeKey ? `${payload.dedupeKey}:${String(group.line_group_id)}` : null,
      status: 'queued', payload: messagePayload(payload), next_attempt_at: new Date().toISOString(),
    }))
    if (rows.length > 0) await getAdminClient().from('shift_line_message_logs').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  } catch (error) { console.error('LINE group announcement queue failed', redactLineError(error)) }
}

/** Queue a group announcement only for approved groups mapped to the
 * assignments' team/type scope. An empty mapping intentionally means no
 * broadcast; private notifications remain independent of this side effect. */
export async function notifyMappedLineGroups(scopes: LineGroupScope[], payload: LineNotification) {
  try {
    const settings = await getLineSettings()
    if (!settings.enabled) return
    const lineGroupIds = await resolveMappedLineGroupIds(scopes)
    if (lineGroupIds.length === 0) return
    const rows = lineGroupIds.map((lineGroupId) => ({
      recipient_type: 'group', line_group_id: lineGroupId, message_type: payload.type,
      reference_type: payload.referenceType ?? null, reference_id: payload.referenceId ?? null,
      dedupe_key: typeof payload.dedupeKey === 'function'
        ? payload.dedupeKey(lineGroupId)
        : payload.dedupeKey ? `${payload.dedupeKey}:${lineGroupId}` : null,
      status: 'queued', payload: messagePayload(payload), next_attempt_at: new Date().toISOString(),
    }))
    await getAdminClient().from('shift_line_message_logs').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  } catch (error) { console.error('LINE mapped group announcement queue failed', redactLineError(error)) }
}

function backoff(attempts: number) {
  return new Date(Date.now() + Math.min(60 * 60_000, 2 ** Math.min(attempts, 8) * 15_000)).toISOString()
}

/** Drain the outbox with bounded retries. It is safe for a cron to call this
 * repeatedly; each row is claimed with an optimistic status update. */
export async function sendQueuedLineMessages(limit = 50) {
  const admin = getAdminClient()
  const { data: rows, error } = await admin.from('shift_line_message_logs')
    .select('id,recipient_type,line_user_id,line_group_id,payload,status,attempts')
    .in('status', ['queued', 'failed']).or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .order('created_at').limit(Math.max(1, Math.min(limit, 200)))
  if (error) throw error
  let sent = 0
  let failed = 0
  for (const row of rows ?? []) {
    const id = String(row.id)
    const oldStatus = String(row.status)
    const { data: claimed } = await admin.from('shift_line_message_logs').update({ status: 'sending', attempts: Number(row.attempts ?? 0) + 1 }).eq('id', id).eq('status', oldStatus).select('id').maybeSingle()
    if (!claimed) continue
    try {
      const recipient = row.recipient_type === 'user' ? row.line_user_id : row.line_group_id
      if (!recipient) throw new Error('missing_recipient')
      const messages = Array.isArray(row.payload) ? row.payload : []
      if (messages.length === 0) throw new Error('missing_payload')
      await pushLineMessage(String(recipient), messages as Record<string, unknown>[])
      await admin.from('shift_line_message_logs').update({ status: 'sent', sent_at: new Date().toISOString(), response_status: 200, error_code: null, error_message: null }).eq('id', id)
      sent += 1
    } catch (reason) {
      const attempts = Number(row.attempts ?? 0) + 1
      await admin.from('shift_line_message_logs').update({ status: attempts >= 5 ? 'dead' : 'failed', error_code: redactLineError(reason), error_message: null, next_attempt_at: attempts >= 5 ? null : backoff(attempts) }).eq('id', id)
      failed += 1
    }
  }
  return { inspected: rows?.length ?? 0, sent, failed }
}
