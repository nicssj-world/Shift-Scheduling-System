import 'server-only'

import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'

export type RequestEvent = {
  id: string
  eventType: string
  fromStatus: string | null
  toStatus: string
  createdAt: string
}

/** Batch-load the append-only audit timeline for request cards. */
export async function getRequestEvents(kind: 'swap' | 'sale', requestIds: string[]) {
  const ids = [...new Set(requestIds)]
  const byRequest = new Map<string, RequestEvent[]>()
  if (ids.length === 0) return byRequest
  // Actionable queues can contain up to 200 requests. Chunk UUID filters so
  // the generated PostgREST URL stays comfortably below proxy limits.
  const chunks = Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, index * 50 + 50))
  const results = await Promise.all(chunks.map((chunk) => getAdminClient()
    .from('shift_request_events')
    .select('id,request_id,event_type,from_status,to_status,created_at')
    .eq('request_kind', kind)
    .in('request_id', chunk)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })))
  const events = results.flatMap((result) => {
    if (result.error) throw new HttpError(500, result.error.message)
    return result.data ?? []
  }).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  for (const event of events) {
    const requestId = String(event.request_id)
    const list = byRequest.get(requestId) ?? []
    list.push({
      id: String(event.id),
      eventType: String(event.event_type),
      fromStatus: event.from_status == null ? null : String(event.from_status),
      toStatus: String(event.to_status),
      createdAt: String(event.created_at),
    })
    byRequest.set(requestId, list)
  }
  return byRequest
}
