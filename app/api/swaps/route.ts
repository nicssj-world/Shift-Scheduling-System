import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { getShiftTypes } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { parseHistoryFilter } from '@/lib/server/pagination'
import { getRequestEvents } from '@/lib/server/request-events'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { createSwapRequest } from '@/lib/server/line-mutations'
import type { Actor } from '@/lib/types'

async function joinSwapDetails(rows: Record<string, unknown>[]) {
  const admin = getAdminClient()
  if (rows.length === 0) return []
  const assignmentIds = [...new Set(rows.flatMap((r) => [String(r.requester_assignment_id), String(r.target_assignment_id)]))]
  const userIds = [...new Set(rows.flatMap((r) => [String(r.requester_id), String(r.target_user_id)]))]
  const [{ data: assignments }, { data: profiles }, shiftTypes, eventsByRequest] = await Promise.all([
    admin.from('shift_assignments').select('id,work_date,shift_type_id,user_id,schedule_id').in('id', assignmentIds),
    admin.from('profiles').select('id,name').in('id', userIds),
    getShiftTypes(),
    getRequestEvents('swap', rows.map((row) => String(row.id))),
  ])
  const assignmentById = new Map((assignments ?? []).map((a) => [String(a.id), a]))
  const nameById = new Map((profiles ?? []).map((p) => [String(p.id), String(p.name)]))
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]))

  return rows.map((r) => {
    const ra = assignmentById.get(String(r.requester_assignment_id))
    const ta = assignmentById.get(String(r.target_assignment_id))
    const raType = ra ? typeById.get(String(ra.shift_type_id)) : null
    const taType = ta ? typeById.get(String(ta.shift_type_id)) : null
    return {
      ...r,
      requesterName: nameById.get(String(r.requester_id)) ?? '',
      targetName: nameById.get(String(r.target_user_id)) ?? '',
      requesterShift: ra ? { date: String(ra.work_date), type: raType?.name_th ?? '', code: raType?.code ?? '' } : null,
      targetShift: ta ? { date: String(ta.work_date), type: taType?.name_th ?? '', code: taType?.code ?? '' } : null,
      events: eventsByRequest.get(String(r.id)) ?? [],
    }
  })
}

/** Pending items needing MY action (respond / approve) — always fetched in
 *  full, never paginated or date-filtered, so they can't be hidden by the
 *  history filter/pager. */
async function getActionableSwaps(actor: Actor) {
  const admin = getAdminClient()
  const conditions = [`and(status.eq.pending_counterpart,target_user_id.eq.${actor.id})`]
  if (actor.isScheduler) conditions.push('status.eq.pending_approval')
  const { data, error } = await admin
    .from('shift_swap_requests').select('*')
    .or(conditions.join(','))
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new HttpError(500, error.message)
  return (data ?? []) as Record<string, unknown>[]
}

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const admin = getAdminClient()
    const filter = parseHistoryFilter(new URL(request.url))

    const actionableRows = await getActionableSwaps(actor)

    let historyQuery = admin.from('shift_swap_requests').select('*', { count: 'exact' })
    if (!actor.isScheduler) historyQuery = historyQuery.or(`requester_id.eq.${actor.id},target_user_id.eq.${actor.id}`)
    if (filter.gte) historyQuery = historyQuery.gte('created_at', filter.gte)
    if (filter.lt) historyQuery = historyQuery.lt('created_at', filter.lt)
    const { data: historyRows, error, count } = await historyQuery
      .order('created_at', { ascending: false })
      .range(filter.offset, filter.offset + filter.pageSize - 1)
    if (error) throw new HttpError(500, error.message)

    return {
      actionable: await joinSwapDetails(actionableRows),
      history: await joinSwapDetails((historyRows ?? []) as Record<string, unknown>[]),
      me: actor.id,
      isScheduler: actor.isScheduler,
      page: filter.page,
      pageSize: filter.pageSize,
      total: count ?? 0,
    }
  })
}

const createSchema = z.object({
  requesterAssignmentId: z.string().uuid(),
  targetAssignmentId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const body = await readJson(request, createSchema)
    const { swap } = await createSwapRequest(actor, body)
    return { swap }
  })
}
