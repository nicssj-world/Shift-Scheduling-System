import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { getShiftTypes } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { parseHistoryFilter } from '@/lib/server/pagination'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { thaiShortDate } from '@/lib/dates'
import type { Actor } from '@/lib/types'

async function joinSaleDetails(rows: Record<string, unknown>[]) {
  const admin = getAdminClient()
  if (rows.length === 0) return []
  const saleIds = rows.map((r) => String(r.id))
  const userIds = [...new Set(rows.flatMap((r) => [String(r.seller_id), String(r.buyer_id)]))]
  const [{ data: items }, { data: profiles }, shiftTypes] = await Promise.all([
    admin.from('shift_sale_items').select('sale_request_id,assignment_id').in('sale_request_id', saleIds),
    admin.from('profiles').select('id,name').in('id', userIds),
    getShiftTypes(),
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
  assignmentIds: z.array(z.string().uuid()).min(1).max(31),
  buyerId: z.string().uuid(),
  reason: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const body = await readJson(request, createSchema)
    if (body.buyerId === actor.id) throw new HttpError(400, 'เลือกผู้ซื้อที่ไม่ใช่ตัวเอง')
    const admin = getAdminClient()

    const { data: assignments, error } = await admin
      .from('shift_assignments')
      .select('id,user_id,schedule_id,work_date,shift_type_id')
      .in('id', body.assignmentIds)
    if (error) throw new HttpError(500, error.message)
    if (!assignments || assignments.length !== body.assignmentIds.length) throw new HttpError(404, 'ไม่พบเวรที่เลือกบางรายการ')
    if (assignments.some((a) => String(a.user_id) !== actor.id)) throw new HttpError(403, 'เลือกได้เฉพาะเวรของตัวเอง')

    const scheduleIds = [...new Set(assignments.map((a) => String(a.schedule_id)))]
    const { data: schedules } = await admin.from('shift_schedules').select('id,status,team_id').in('id', scheduleIds)
    for (const s of schedules ?? []) {
      if (String(s.status) === 'locked') throw new HttpError(409, 'ตารางเวรถูกล็อคแล้ว ไม่สามารถขายเวรได้')
    }
    const teamIds = [...new Set((schedules ?? []).map((s) => String(s.team_id)))]
    if (teamIds.length > 1) throw new HttpError(400, 'ขายเวรได้เฉพาะภายในทีมเดียวกัน')

    const { data: buyerMembership } = await admin
      .from('shift_team_members').select('id')
      .eq('team_id', teamIds[0]).eq('user_id', body.buyerId).eq('is_active', true)
      .maybeSingle()
    if (!buyerMembership) throw new HttpError(400, 'ผู้ซื้อต้องเป็นสมาชิกทีมเดียวกัน')

    const { data: saleRequestRow, error: insertError } = await admin
      .from('shift_sale_requests')
      .insert({ seller_id: actor.id, buyer_id: body.buyerId, reason: body.reason ?? null })
      .select('*')
      .single()
    if (insertError) throw new HttpError(500, insertError.message)
    const saleRequest = saleRequestRow as { id: string }

    const itemRows = assignments.map((a) => ({ sale_request_id: saleRequest.id, assignment_id: a.id }))
    const { error: itemsError } = await admin.from('shift_sale_items').insert(itemRows)
    if (itemsError) throw new HttpError(500, itemsError.message)

    const firstDate = [...assignments].sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)))[0]
    await notifyUsers([body.buyerId], {
      type: 'sale_requested',
      title: `${actor.name} เสนอขายเวรให้คุณ ${assignments.length} เวร`,
      body: `เริ่มวันที่ ${thaiShortDate(String(firstDate.work_date))}`,
      link: '/swaps',
    })
    return { sale: saleRequest }
  })
}
