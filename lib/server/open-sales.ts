import 'server-only'

import { bangkokDateString, bangkokMonthNow, datesOfMonth, monthRange } from '@/lib/dates'
import { getShiftTypes, getTeams } from '@/lib/server/data'
import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'
import type { Actor, ShiftType, Team } from '@/lib/types'

export type OpenSaleShift = {
  assignmentId: string
  scheduleId: string
  date: string
  shiftTypeId: string
  code: string
  typeName: string
  startTime: string
  endTime: string
}

export type OpenSaleListing = {
  id: string
  sellerId: string
  sellerName: string
  reason: string | null
  status: 'open'
  saleMode: 'open'
  createdAt: string
  teamId: string
  teamName: string
  activeShiftCount: number
  shifts: OpenSaleShift[]
}

export type OpenSalesOptions = {
  from?: string | null
  to?: string | null
  teamId?: string | null
  page?: number
  pageSize?: number
}

function validMonth(value: string | null | undefined, label: string) {
  if (value == null || value === '') return null
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, `${label} ต้องอยู่ในรูปแบบ YYYY-MM`)
  }
  return value
}

function normalizeOptions(options: OpenSalesOptions) {
  const from = validMonth(options.from, 'เดือนเริ่มต้น')
  const to = validMonth(options.to, 'เดือนสิ้นสุด')
  if (from && to && from > to) throw new HttpError(400, 'เดือนเริ่มต้นต้องไม่มากกว่าเดือนสิ้นสุด')
  const rawPage = Number(options.page ?? 1)
  const rawPageSize = Number(options.pageSize ?? 20)
  if (!Number.isFinite(rawPage) || !Number.isFinite(rawPageSize)) throw new HttpError(400, 'page/pageSize ต้องเป็นตัวเลข')
  const page = Math.max(1, Math.floor(rawPage))
  const pageSize = Math.min(100, Math.max(1, Math.floor(rawPageSize)))
  return { from, to, teamId: options.teamId ? String(options.teamId) : null, page, pageSize }
}

/** Housekeeping is deliberately a small RPC call and is safe to invoke before
 * every marketplace read/mutation. The database function is idempotent and
 * uses the Bangkok calendar date, so today's shifts remain claimable. */
export async function expireOpenSaleListings() {
  const { error } = await getAdminClient().rpc('shift_expire_open_sale_items', {
    p_as_of_date: bangkokDateString(),
  })
  if (error) throw new HttpError(500, 'อัปเดตรายการเวรหมดอายุไม่สำเร็จ')
}

async function visibleTeamIds(actor: Actor, requestedTeamId: string | null) {
  const teams = (await getTeams()).filter((team) => team.is_active)
  const allIds = new Set(teams.map((team) => String(team.id)))
  let allowedIds: string[]
  if (actor.isScheduler) {
    allowedIds = teams.map((team) => String(team.id))
  } else {
    const { data, error } = await getAdminClient().from('shift_team_members')
      .select('team_id').eq('user_id', actor.id).eq('is_active', true)
    if (error) throw new HttpError(500, 'อ่านสิทธิ์สมาชิกทีมไม่สำเร็จ')
    allowedIds = [...new Set((data ?? []).map((row) => String(row.team_id)).filter((id) => allIds.has(id)))]
  }
  if (requestedTeamId) {
    if (!allowedIds.includes(requestedTeamId)) throw new HttpError(403, 'คุณไม่มีสิทธิ์ดูตลาดของทีมนี้')
    return { teams, ids: [requestedTeamId] }
  }
  return { teams, ids: allowedIds }
}

function typeMap(types: ShiftType[]) {
  return new Map(types.map((type) => [String(type.id), type]))
}

function teamMap(teams: Team[]) {
  return new Map(teams.map((team) => [String(team.id), team]))
}

function monthBounds(from: string | null, to: string | null) {
  if (!from && !to) return { start: null as string | null, end: null as string | null }
  // A lower bound without an upper bound means "from this month onward".
  // This is also what the marketplace's default future-shifts view needs.
  const start = from ? datesOfMonth(from)[0] : null
  const end = to ? datesOfMonth(to).at(-1)! : null
  return { start, end }
}

/** Shared marketplace query used by the authenticated web API and LINE
 * session API. Grouping happens before pagination, so one sale request is
 * always one card regardless of how many schedules/months it contains. */
export async function getOpenSales(actor: Actor, options: OpenSalesOptions = {}) {
  const normalized = normalizeOptions(options)
  await expireOpenSaleListings()
  const scope = await visibleTeamIds(actor, normalized.teamId)
  const teamsById = teamMap(scope.teams)
  if (scope.ids.length === 0) {
    return {
      from: normalized.from,
      to: normalized.to,
      today: bangkokDateString(),
      teams: scope.teams.map((team) => ({ id: String(team.id), code: team.code, name: team.name_th })),
      listings: [] as OpenSaleListing[],
      sales: [] as OpenSaleListing[],
      page: normalized.page,
      pageSize: normalized.pageSize,
      total: 0,
    }
  }

  const admin = getAdminClient()
  let scheduleQuery = admin.from('shift_schedules')
    .select('id,team_id,month,status')
    .in('team_id', scope.ids)
    .eq('status', 'published')
  if (normalized.from) scheduleQuery = scheduleQuery.gte('month', `${normalized.from}-01`)
  if (normalized.to) scheduleQuery = scheduleQuery.lte('month', `${normalized.to}-01`)
  const { data: schedules, error: scheduleError } = await scheduleQuery
  if (scheduleError) throw new HttpError(500, 'อ่านตารางเวรสำหรับตลาดไม่สำเร็จ')
  const scheduleRows = (schedules ?? []).map((row) => ({
    id: String(row.id), teamId: String(row.team_id), month: String(row.month).slice(0, 7), status: String(row.status),
  }))
  const scheduleIds = scheduleRows.map((row) => row.id)
  const scheduleById = new Map(scheduleRows.map((row) => [row.id, row]))
  if (scheduleIds.length === 0) {
    return {
      from: normalized.from,
      to: normalized.to,
      today: bangkokDateString(),
      teams: scope.teams.map((team) => ({ id: String(team.id), code: team.code, name: team.name_th })),
      listings: [] as OpenSaleListing[],
      sales: [] as OpenSaleListing[],
      page: normalized.page,
      pageSize: normalized.pageSize,
      total: 0,
    }
  }

  const { data: sales, error: salesError } = await admin.from('shift_sale_requests')
    .select('id,seller_id,reason,status,sale_mode,created_at')
    .eq('sale_mode', 'open').eq('status', 'open')
    .order('created_at', { ascending: false }).limit(1000)
  if (salesError) throw new HttpError(500, 'อ่านประกาศขายเวรไม่สำเร็จ')
  const saleRows = sales ?? []
  if (saleRows.length === 0) {
    return {
      from: normalized.from,
      to: normalized.to,
      today: bangkokDateString(),
      teams: scope.teams.map((team) => ({ id: String(team.id), code: team.code, name: team.name_th })),
      listings: [] as OpenSaleListing[],
      sales: [] as OpenSaleListing[],
      page: normalized.page,
      pageSize: normalized.pageSize,
      total: 0,
    }
  }
  const saleIds = saleRows.map((row) => String(row.id))
  const [{ data: items, error: itemError }, types] = await Promise.all([
    admin.from('shift_sale_items').select('sale_request_id,assignment_id,status').in('sale_request_id', saleIds).eq('status', 'active'),
    getShiftTypes(),
  ])
  if (itemError) throw new HttpError(500, 'อ่านรายการเวรที่ประกาศไม่สำเร็จ')
  const assignmentIds = [...new Set((items ?? []).map((item) => String(item.assignment_id)))]
  if (assignmentIds.length === 0) {
    return {
      from: normalized.from,
      to: normalized.to,
      today: bangkokDateString(),
      teams: scope.teams.map((team) => ({ id: String(team.id), code: team.code, name: team.name_th })),
      listings: [] as OpenSaleListing[],
      sales: [] as OpenSaleListing[],
      page: normalized.page,
      pageSize: normalized.pageSize,
      total: 0,
    }
  }
  const [{ data: assignments, error: assignmentError }, { data: profiles, error: profileError }] = await Promise.all([
    admin.from('shift_assignments').select('id,schedule_id,work_date,shift_type_id,user_id').in('id', assignmentIds),
    admin.from('profiles').select('id,name').in('id', [...new Set(saleRows.map((row) => String(row.seller_id)))]),
  ])
  if (assignmentError || profileError) throw new HttpError(500, 'อ่านรายละเอียดประกาศไม่สำเร็จ')
  const assignmentById = new Map((assignments ?? []).map((row) => [String(row.id), row]))
  const profileById = new Map((profiles ?? []).map((row) => [String(row.id), String(row.name ?? '')]))
  const typesById = typeMap(types)
  const bounds = monthBounds(normalized.from, normalized.to)
  const today = bangkokDateString()
  const idsBySale = new Map<string, string[]>()
  for (const item of items ?? []) {
    const assignment = assignmentById.get(String(item.assignment_id))
    if (!assignment || String(assignment.work_date) < today) continue
    const schedule = scheduleById.get(String(assignment.schedule_id))
    if (!schedule || !scope.ids.includes(schedule.teamId)) continue
    idsBySale.set(String(item.sale_request_id), [...(idsBySale.get(String(item.sale_request_id)) ?? []), String(item.assignment_id)])
  }
  const grouped: OpenSaleListing[] = []
  for (const sale of saleRows) {
    const ids = idsBySale.get(String(sale.id)) ?? []
    const firstAssignment = ids.length > 0 ? assignmentById.get(ids[0]) : undefined
    const firstSchedule = firstAssignment ? scheduleById.get(String(firstAssignment.schedule_id)) : undefined
    const shifts = ids.map((id) => {
      const assignment = assignmentById.get(id)!
      const type = typesById.get(String(assignment.shift_type_id))
      return {
        assignmentId: id,
        scheduleId: String(assignment.schedule_id),
        date: String(assignment.work_date),
        shiftTypeId: String(assignment.shift_type_id),
        code: type?.code ?? '?',
        typeName: type?.name_th ?? '?',
        startTime: type?.start_time?.slice(0, 5) ?? '',
        endTime: type?.end_time?.slice(0, 5) ?? '',
      }
    }).sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))
    if (shifts.length === 0) continue
    const matchesFilter = shifts.some((shift) =>
      (!bounds.start || shift.date >= bounds.start) && (!bounds.end || shift.date <= bounds.end),
    )
    if (!matchesFilter) continue
    const teamId = firstSchedule?.teamId ?? ''
    if (!teamId) continue
    grouped.push({
      id: String(sale.id),
      sellerId: String(sale.seller_id),
      sellerName: profileById.get(String(sale.seller_id)) ?? '',
      reason: sale.reason ? String(sale.reason) : null,
      status: 'open',
      saleMode: 'open',
      createdAt: String(sale.created_at),
      teamId,
      teamName: teamsById.get(teamId)?.name_th ?? '',
      activeShiftCount: shifts.length,
      shifts,
    })
  }
  grouped.sort((a, b) => a.shifts[0].date.localeCompare(b.shifts[0].date) || b.createdAt.localeCompare(a.createdAt))
  const total = grouped.length
  const start = (normalized.page - 1) * normalized.pageSize
  const listings = grouped.slice(start, start + normalized.pageSize)
  const result = {
    from: normalized.from,
    to: normalized.to,
    today,
    teams: scope.teams.map((team) => ({ id: String(team.id), code: team.code, name: team.name_th })),
    listings,
    // Keep the old LINE response key during the UI rollout.
    sales: listings,
    page: normalized.page,
    pageSize: normalized.pageSize,
    total,
  }
  return result
}

/** Used by option pickers to validate a month range without exposing the
 * marketplace's sale rows. */
export function normalizeOpenSaleMonthRange(from?: string | null, to?: string | null) {
  const start = validMonth(from, 'เดือนเริ่มต้น') ?? bangkokMonthNow()
  // Option pickers use an omitted end month to mean "all future published
  // schedules". Keep the query bounded to monthRange's safety cap while still
  // supporting the normal multi-month selection flow.
  const end = validMonth(to, 'เดือนสิ้นสุด') ?? monthRange(start, '9999-12').at(-1)!
  if (start > end) throw new HttpError(400, 'เดือนเริ่มต้นต้องไม่มากกว่าเดือนสิ้นสุด')
  return monthRange(start, end)
}
