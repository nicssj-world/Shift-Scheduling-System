import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { getShiftTypes, getSwapSettings } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { notifyUsers } from '@/lib/server/notify'
import { parseHistoryFilter } from '@/lib/server/pagination'
import { readJson, respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { thaiShortDate } from '@/lib/dates'
import type { Actor } from '@/lib/types'

async function joinSwapDetails(rows: Record<string, unknown>[]) {
  const admin = getAdminClient()
  if (rows.length === 0) return []
  const assignmentIds = [...new Set(rows.flatMap((r) => [String(r.requester_assignment_id), String(r.target_assignment_id)]))]
  const userIds = [...new Set(rows.flatMap((r) => [String(r.requester_id), String(r.target_user_id)]))]
  const [{ data: assignments }, { data: profiles }, shiftTypes] = await Promise.all([
    admin.from('shift_assignments').select('id,work_date,shift_type_id,user_id,schedule_id').in('id', assignmentIds),
    admin.from('profiles').select('id,name').in('id', userIds),
    getShiftTypes(),
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
    const admin = getAdminClient()

    const { data: assignments, error } = await admin
      .from('shift_assignments')
      .select('id,user_id,work_date,shift_type_id,schedule_id')
      .in('id', [body.requesterAssignmentId, body.targetAssignmentId])
    if (error) throw new HttpError(500, error.message)
    const mine = assignments?.find((a) => String(a.id) === body.requesterAssignmentId)
    const theirs = assignments?.find((a) => String(a.id) === body.targetAssignmentId)
    if (!mine || !theirs) throw new HttpError(404, 'ไม่พบเวรที่เลือก')
    if (String(mine.user_id) !== actor.id) throw new HttpError(403, 'เลือกได้เฉพาะเวรของตัวเอง')
    if (String(theirs.user_id) === actor.id) throw new HttpError(400, 'เลือกเวรของเพื่อนร่วมงานเป็นคู่แลก')

    // both schedules must not be locked
    const scheduleIds = [...new Set([String(mine.schedule_id), String(theirs.schedule_id)])]
    const { data: schedules } = await admin.from('shift_schedules').select('id,status,team_id').in('id', scheduleIds)
    for (const s of schedules ?? []) {
      if (String(s.status) === 'locked') throw new HttpError(409, 'ตารางเวรถูกล็อคแล้ว ไม่สามารถขอแลกเวรได้')
    }
    const teamIds = new Set((schedules ?? []).map((s) => String(s.team_id)))
    if (teamIds.size > 1) throw new HttpError(400, 'แลกเวรได้เฉพาะภายในทีมเดียวกัน')

    const { data: swap, error: insertError } = await admin
      .from('shift_swap_requests')
      .insert({
        requester_assignment_id: body.requesterAssignmentId,
        target_assignment_id: body.targetAssignmentId,
        requester_id: actor.id,
        target_user_id: String(theirs.user_id),
        reason: body.reason ?? null,
      })
      .select('*')
      .single()
    if (insertError) throw new HttpError(500, insertError.message)

    await notifyUsers([String(theirs.user_id)], {
      type: 'swap_requested',
      title: `${actor.name} ขอแลกเวรกับคุณ`,
      body: `เวรวันที่ ${thaiShortDate(String(mine.work_date))} ↔ ${thaiShortDate(String(theirs.work_date))}`,
      link: '/swaps',
    })
    return { swap }
  })
}
