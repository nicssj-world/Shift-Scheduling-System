import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { getShiftTypes } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { parseHistoryFilter } from '@/lib/server/pagination'
import { getRequestEvents } from '@/lib/server/request-events'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { createDirectSaleRequest, createOpenSaleRequest } from '@/lib/server/line-mutations'
import type { Actor } from '@/lib/types'

async function joinSaleDetails(rows: Record<string, unknown>[]) {
  const admin = getAdminClient()
  if (rows.length === 0) return []
  const saleIds = rows.map((r) => String(r.id))
  const userIds = [...new Set(rows.flatMap((r) => [r.seller_id, r.buyer_id]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)))]
  const [{ data: items }, { data: profiles }, shiftTypes, eventsByRequest] = await Promise.all([
    admin.from('shift_sale_items').select('sale_request_id,assignment_id').in('sale_request_id', saleIds),
    admin.from('profiles').select('id,name').in('id', userIds),
    getShiftTypes(),
    getRequestEvents('sale', saleIds),
  ])
  const assignmentIds = [...new Set((items ?? []).map((i) => String(i.assignment_id)))]
  const { data: assignments } = assignmentIds.length > 0
    ? await admin.from('shift_assignments').select('id,work_date,shift_type_id').in('id', assignmentIds)
    : { data: [] as { id: string; work_date: string; shift_type_id: string }[] }
  const assignmentById = new Map((assignments ?? []).map((a) => [String(a.id), a]))
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]))
  const nameById = new Map((profiles ?? []).map((p) => [String(p.id), String(p.name)]))

  const itemsBySale = new Map<string, string[]>()
  for (const item of items ?? []) {
    const list = itemsBySale.get(String(item.sale_request_id)) ?? []
    list.push(String(item.assignment_id))
    itemsBySale.set(String(item.sale_request_id), list)
  }

  return rows.map((r) => {
    const assignmentIdsForSale = itemsBySale.get(String(r.id)) ?? []
    const shifts = assignmentIdsForSale
      .map((id) => assignmentById.get(id))
      .filter((a): a is { id: string; work_date: string; shift_type_id: string } => Boolean(a))
      .map((a) => {
        const type = typeById.get(String(a.shift_type_id))
        return { date: String(a.work_date), code: type?.code ?? '?', type: type?.name_th ?? '?' }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
    return {
      ...r,
      sellerName: nameById.get(String(r.seller_id)) ?? '',
      buyerName: nameById.get(String(r.buyer_id)) ?? '',
      shifts,
      events: eventsByRequest.get(String(r.id)) ?? [],
    }
  })
}

/** Pending items needing MY action (respond / approve) — always fetched in
 *  full, never paginated or date-filtered, so they can't be hidden by the
 *  history filter/pager. */
async function getActionableSales(actor: Actor) {
  const admin = getAdminClient()
  const conditions = [`and(status.eq.pending_buyer,buyer_id.eq.${actor.id})`]
  if (actor.isScheduler) conditions.push('status.eq.pending_approval')
  const { data, error } = await admin
    .from('shift_sale_requests').select('*')
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

    const actionableRows = await getActionableSales(actor)

    let historyQuery = admin.from('shift_sale_requests').select('*', { count: 'exact' })
    if (!actor.isScheduler) historyQuery = historyQuery.or(`seller_id.eq.${actor.id},buyer_id.eq.${actor.id}`)
    if (filter.gte) historyQuery = historyQuery.gte('created_at', filter.gte)
    if (filter.lt) historyQuery = historyQuery.lt('created_at', filter.lt)
    const { data: historyRows, error, count } = await historyQuery
      .order('created_at', { ascending: false })
      .range(filter.offset, filter.offset + filter.pageSize - 1)
    if (error) throw new HttpError(500, error.message)

    return {
      actionable: await joinSaleDetails(actionableRows),
      history: await joinSaleDetails((historyRows ?? []) as Record<string, unknown>[]),
      me: actor.id,
      isScheduler: actor.isScheduler,
      page: filter.page,
      pageSize: filter.pageSize,
      total: count ?? 0,
    }
  })
}

const createSchema = z.object({
  mode: z.enum(['direct', 'open']).default('direct'),
  assignmentIds: z.array(z.string().uuid()).min(1).max(31)
    .refine((ids) => new Set(ids).size === ids.length, 'มีรายการเวรซ้ำกัน'),
  buyerId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const body = await readJson(request, createSchema)
    if (body.mode === 'open') {
      const { sale: saleRequest } = await createOpenSaleRequest(actor, body, 'web')
      return { sale: saleRequest }
    }
    if (!body.buyerId) throw new HttpError(400, 'กรุณาเลือกผู้รับเวร')
    const { sale: saleRequest } = await createDirectSaleRequest(actor, { ...body, buyerId: body.buyerId })
    return { sale: saleRequest }
  })
}
