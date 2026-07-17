import 'server-only'

import { HttpError } from '@/lib/server/errors'
import { throwRequestRpcError } from '@/lib/server/request-rpc'
import { getAdminClient } from '@/lib/supabase/admin'

export async function transitionRequestStatus(
  table: 'shift_swap_requests' | 'shift_sale_requests',
  id: string,
  expectedStatus: string,
  patch: Record<string, unknown>,
  actorId: string,
) {
  const kind = table === 'shift_swap_requests' ? 'swap' : 'sale'
  const { data, error } = await getAdminClient().rpc('shift_transition_request', {
    p_request_kind: kind,
    p_request_id: id,
    p_expected_status: expectedStatus,
    p_new_status: String(patch.status),
    p_actor_id: actorId,
    p_responded_at: patch.counterpart_responded_at ?? patch.buyer_responded_at ?? null,
    p_decided_by: patch.decided_by ?? null,
    p_decided_at: patch.decided_at ?? null,
  })
  if (error) throwRequestRpcError(error, 'เปลี่ยนสถานะคำขอไม่สำเร็จ')
  if (!data) throw new HttpError(409, 'สถานะคำขอมีการเปลี่ยนแปลง กรุณารีเฟรชแล้วลองใหม่')
  return data
}
