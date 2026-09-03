import 'server-only'

import { getAdminClient } from '@/lib/supabase/admin'

export async function writeLineAudit(input: {
  actorUserId?: string | null
  source?: 'web' | 'line' | 'admin' | 'system'
  action: string
  referenceType?: string | null
  referenceId?: string | null
  oldValue?: unknown
  newValue?: unknown
}) {
  const { error } = await getAdminClient().from('shift_line_audit_events').insert({
    actor_user_id: input.actorUserId ?? null,
    source: input.source ?? 'line',
    action: input.action,
    reference_type: input.referenceType ?? null,
    reference_id: input.referenceId ?? null,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
  })
  if (error) console.error('LINE audit write failed', error.code ?? 'unknown')
}
