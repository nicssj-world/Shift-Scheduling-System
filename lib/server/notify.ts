import 'server-only'

import { getAdminClient } from '@/lib/supabase/admin'
import { notifyLineUsers } from '@/lib/server/line-notify'

export type NotifyPayload = {
  type: string
  title: string
  body?: string
  link?: string
  /** unique key making the insert idempotent (used by the cron reminder) */
  dedupeKey?: (userId: string) => string
  /** Set false when an existing non-LINE dispatcher owns delivery timing. */
  sendLine?: boolean
  referenceType?: string
  referenceId?: string
}

/** Insert in-app notifications for a set of users (service role only). */
export async function notifyUsers(userIds: string[], payload: NotifyPayload) {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (unique.length === 0) return
  const rows = unique.map((userId) => ({
    user_id: userId,
    type: payload.type,
    title: payload.title,
    body: payload.body ?? null,
    link: payload.link ?? null,
    dedupe_key: payload.dedupeKey ? payload.dedupeKey(userId) : null,
  }))
  const admin = getAdminClient()
  if (payload.dedupeKey) {
    await admin.from('shift_notifications').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  } else {
    await admin.from('shift_notifications').insert(rows)
  }
  // LINE is an outbox side effect. It is deliberately best-effort and never
  // allowed to make the core mutation fail.
  if (payload.sendLine !== false) {
    await notifyLineUsers(unique, {
      type: payload.type,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      dedupeKey: payload.dedupeKey,
      referenceType: payload.referenceType,
      referenceId: payload.referenceId,
    })
  }
}
