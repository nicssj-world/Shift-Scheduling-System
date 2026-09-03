import 'server-only'

import { bangkokDateString, bangkokMonthNow } from '@/lib/dates'
import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'
import { getShiftTypes, getTeamMembersForTeams, getTeams } from '@/lib/server/data'
import { getOpenSales } from '@/lib/server/open-sales'
import type { LineGroupScope } from '@/lib/server/line-group-mapping'
import type { Actor, ShiftType } from '@/lib/types'

function monthOrNow(value: string | null | undefined) {
  const month = value ?? bangkokMonthNow()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)')
  return month
}

function typeMap(types: ShiftType[]) {
  return new Map(types.map((type) => [type.id, type]))
}

export async function getLineSchedule(actor: Actor, requestedMonth?: string | null, requestedTeamId?: string | null) {
  const month = monthOrNow(requestedMonth)
  const admin = getAdminClient()
  const teams = (await getTeams()).filter((team) => team.is_active)
  const team = requestedTeamId ? teams.find((item) => item.id === requestedTeamId) : null
  if (requestedTeamId && !team) throw new HttpError(404, 'ไม่พบทีม')
  const selectedTeams = team ? [team] : teams
  if (selectedTeams.length === 0) {
    return { month, today: bangkokDateString(), teams: [], members: [], schedules: [], assignments: [] }
  }
  const { data: schedules, error: schedulesError } = await admin.from('shift_schedules')
    .select('id,team_id,month,status')
    .in('team_id', selectedTeams.map((item) => item.id))
    .eq('month', `${month}-01`)
    .in('status', actor.isScheduler ? ['draft', 'published', 'locked'] : ['published', 'locked'])
  if (schedulesError) throw new HttpError(500, 'อ่านตารางเวรไม่สำเร็จ')

  const scheduleRows = schedules ?? []
  const scheduleIds = scheduleRows.map((row) => String(row.id))
  const [types, membersResult] = await Promise.all([
    getShiftTypes(),
    getTeamMembersForTeams(selectedTeams.map((item) => item.id)),
  ])
  const assignmentsResult = scheduleIds.length > 0
    ? await admin.from('shift_assignments').select('id,schedule_id,work_date,shift_type_id,user_id,job_id,source')
      .in('schedule_id', scheduleIds).order('work_date').order('shift_type_id')
    : { data: [], error: null }
  if (assignmentsResult.error) throw new HttpError(500, 'อ่านเวรไม่สำเร็จ')
  const membersById = new Map(membersResult.map((member) => [member.user_id, member]))
  const typesById = typeMap(types)
  const scheduleById = new Map(scheduleRows.map((row) => [String(row.id), row]))
  const assignments = (assignmentsResult.data ?? []).map((row) => {
    const type = typesById.get(String(row.shift_type_id))
    const member = membersById.get(String(row.user_id))
    return {
      id: String(row.id),
      scheduleId: String(row.schedule_id),
      teamId: String(scheduleById.get(String(row.schedule_id))?.team_id ?? ''),
      workDate: String(row.work_date),
      shiftTypeId: String(row.shift_type_id),
      code: type?.code ?? '?',
      typeName: type?.name_th ?? '?',
      startTime: type?.start_time?.slice(0, 5) ?? '',
      endTime: type?.end_time?.slice(0, 5) ?? '',
      userId: String(row.user_id),
      userName: member?.displayName ?? '',
      mine: String(row.user_id) === actor.id,
      jobId: row.job_id ? String(row.job_id) : null,
      source: String(row.source ?? 'auto'),
    }
  })
  return {
    month,
    today: bangkokDateString(),
    teams: selectedTeams.map((item) => ({ id: item.id, code: item.code, name: item.name_th })),
    members: membersResult.map((member) => ({ userId: member.user_id, userName: member.displayName, teamId: member.team_id })),
    schedules: scheduleRows.map((row) => ({
      id: String(row.id), teamId: String(row.team_id), status: String(row.status),
    })),
    assignments,
  }
}

export async function getLineMyShifts(actor: Actor, requestedMonth?: string | null) {
  const month = monthOrNow(requestedMonth)
  const schedule = await getLineSchedule(actor, month)
  return {
    month,
    shifts: schedule.assignments.filter((assignment) => assignment.mine),
  }
}

export async function getLineDailyRoster(actor: Actor, date = bangkokDateString(), includePhone = false, scopes?: LineGroupScope[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'รูปแบบวันที่ไม่ถูกต้อง')
  const admin = getAdminClient()
  const { data: schedules, error: scheduleError } = await admin.from('shift_schedules')
    .select('id,team_id,status').in('status', ['published', 'locked'])
  if (scheduleError) throw new HttpError(500, 'อ่านตารางเวรไม่สำเร็จ')
  const scheduleIds = (schedules ?? []).map((row) => String(row.id))
  if (scheduleIds.length === 0) return { date, teams: [] }
  const teamIds = [...new Set((schedules ?? []).map((row) => String(row.team_id)))]
  const [{ data: assignments, error: assignmentError }, teams, members, types] = await Promise.all([
    admin.from('shift_assignments').select('id,schedule_id,work_date,shift_type_id,user_id,job_id')
      .eq('work_date', date).in('schedule_id', scheduleIds),
    getTeams(),
    getTeamMembersForTeams(teamIds),
    getShiftTypes(),
  ])
  if (assignmentError) throw new HttpError(500, 'อ่านเวรประจำวันไม่สำเร็จ')
  const scheduleById = new Map((schedules ?? []).map((row) => [String(row.id), String(row.team_id)]))
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const memberById = new Map(members.map((member) => [member.user_id, member]))
  const typeById = typeMap(types)
  const rows = (assignments ?? []).map((row) => {
    const member = memberById.get(String(row.user_id))
    const type = typeById.get(String(row.shift_type_id))
    const teamId = scheduleById.get(String(row.schedule_id)) ?? ''
    return {
      id: String(row.id), teamId, teamName: teamById.get(teamId)?.name_th ?? '',
      userId: String(row.user_id), userName: member?.displayName ?? '',
      phone: includePhone && member?.profile ? member.profile.phone : null,
      shiftTypeId: String(row.shift_type_id), code: type?.code ?? '?', typeName: type?.name_th ?? '?',
      startTime: type?.start_time?.slice(0, 5) ?? '', endTime: type?.end_time?.slice(0, 5) ?? '',
    }
  }).filter((row) => {
    if (scopes === undefined) return true
    const teamScopes = scopes.filter((scope) => String(scope.teamId) === row.teamId)
    if (teamScopes.length === 0) return false
    const specificTypes = new Set(teamScopes.map((scope) => scope.shiftTypeId).filter((id): id is string => Boolean(id)))
    return specificTypes.size > 0 ? specificTypes.has(row.shiftTypeId) : teamScopes.some((scope) => !scope.shiftTypeId)
  })
  const grouped = new Map<string, typeof rows>()
  for (const row of rows) grouped.set(row.teamId, [...(grouped.get(row.teamId) ?? []), row])
  return {
    date,
    teams: [...grouped.entries()].map(([teamId, roster]) => ({
      teamId, teamName: teamById.get(teamId)?.name_th ?? '',
      shifts: roster.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.userName.localeCompare(b.userName)),
    })),
    viewer: actor.id,
  }
}

export async function getLineOpenSales(actor: Actor, month?: string | null) {
  const selectedMonth = monthOrNow(month)
  return { ...await getOpenSales(actor, { from: selectedMonth, to: selectedMonth }), month: selectedMonth }
  /*
  const today = bangkokDateString()
  const admin = getAdminClient()
  const { data: memberships } = await admin.from('shift_team_members').select('team_id')
    .eq('user_id', actor.id).eq('is_active', true)
  const teamIds = [...new Set((memberships ?? []).map((row) => String(row.team_id)))]
  if (teamIds.length === 0) return { month: selectedMonth, sales: [] }
  const { data: schedules, error: scheduleError } = await admin.from('shift_schedules').select('id,team_id')
    .in('team_id', teamIds).eq('month', `${selectedMonth}-01`).in('status', ['published'])
  if (scheduleError) throw new HttpError(500, 'อ่านตารางขายเวรไม่สำเร็จ')
  const scheduleIds = (schedules ?? []).map((row) => String(row.id))
  if (scheduleIds.length === 0) return { month: selectedMonth, sales: [] }
  const { data: sales, error: saleError } = await admin.from('shift_sale_requests')
    .select('id,seller_id,buyer_id,reason,status,sale_mode,claimed_at,created_at')
    .eq('sale_mode', 'open').eq('status', 'open').order('created_at', { ascending: false }).limit(100)
  if (saleError) throw new HttpError(500, 'อ่านประกาศขายเวรไม่สำเร็จ')
  const saleIds = (sales ?? []).map((row) => String(row.id))
  if (saleIds.length === 0) return { month: selectedMonth, sales: [] }
  const [{ data: items }, { data: profiles }, types] = await Promise.all([
    admin.from('shift_sale_items').select('sale_request_id,assignment_id').in('sale_request_id', saleIds),
    admin.from('profiles').select('id,name').in('id', [...new Set((sales ?? []).map((row) => String(row.seller_id)))]),
    getShiftTypes(),
  ])
  const itemIds = (items ?? []).map((row) => String(row.assignment_id))
  const { data: assignments } = itemIds.length > 0
    ? await admin.from('shift_assignments').select('id,schedule_id,work_date,shift_type_id,user_id').in('id', itemIds)
    : { data: [] as Record<string, unknown>[] }
  const scheduleSet = new Set(scheduleIds)
  const scheduleById = new Map((schedules ?? []).map((row) => [String(row.id), String(row.team_id)]))
  const typeById = typeMap(types)
  const nameById = new Map((profiles ?? []).map((row) => [String(row.id), String(row.name ?? '')]))
  const assignmentById = new Map((assignments ?? []).map((row) => [String(row.id), row]))
  const itemsBySale = new Map<string, Record<string, unknown>[]>()
  for (const item of items ?? []) itemsBySale.set(String(item.sale_request_id), [...(itemsBySale.get(String(item.sale_request_id)) ?? []), assignmentById.get(String(item.assignment_id))].filter(Boolean) as Record<string, unknown>[])
  return {
    month: selectedMonth,
    sales: (sales ?? []).map((sale) => {
      const saleItems = (itemsBySale.get(String(sale.id)) ?? []).filter((item) => scheduleSet.has(String(item.schedule_id)))
      return {
        id: String(sale.id), sellerId: String(sale.seller_id), sellerName: nameById.get(String(sale.seller_id)) ?? '',
        reason: sale.reason ? String(sale.reason) : null, status: String(sale.status), saleMode: 'open' as const,
        claimedAt: sale.claimed_at ? String(sale.claimed_at) : null, createdAt: String(sale.created_at),
        teamId: saleItems[0] ? scheduleById.get(String(saleItems[0].schedule_id)) ?? '' : '',
        shifts: saleItems.map((item) => {
          const type = typeById.get(String(item.shift_type_id))
          return { assignmentId: String(item.id), date: String(item.work_date), code: type?.code ?? '?', typeName: type?.name_th ?? '?' }
        }).sort((a, b) => a.date.localeCompare(b.date)),
      }
    }).filter((sale) => sale.shifts.length > 0 && sale.shifts.every((shift) => shift.date >= today)),
  }
  */
}

export async function getLineRequests(actor: Actor) {
  const admin = getAdminClient()
  const swapScope = actor.isScheduler
    ? `requester_id.eq.${actor.id},target_user_id.eq.${actor.id},status.eq.pending_approval`
    : `requester_id.eq.${actor.id},target_user_id.eq.${actor.id}`
  const saleScope = actor.isScheduler
    ? `seller_id.eq.${actor.id},buyer_id.eq.${actor.id},status.eq.pending_approval`
    : `seller_id.eq.${actor.id},buyer_id.eq.${actor.id}`
  const [{ data: swaps, error: swapError }, { data: sales, error: saleError }] = await Promise.all([
    admin.from('shift_swap_requests').select('id,requester_id,target_user_id,status,reason,created_at,requester_assignment_id,target_assignment_id')
      .or(swapScope).order('created_at', { ascending: false }).limit(100),
    admin.from('shift_sale_requests').select('id,seller_id,buyer_id,status,sale_mode,reason,created_at,claimed_at')
      .or(saleScope).order('created_at', { ascending: false }).limit(100),
  ])
  if (swapError || saleError) throw new HttpError(500, 'อ่านคำขอไม่สำเร็จ')
  const approvalSwaps = actor.isScheduler ? (swaps ?? []).filter((row) => String(row.status) === 'pending_approval') : []
  const approvalSales = actor.isScheduler ? (sales ?? []).filter((row) => String(row.status) === 'pending_approval') : []
  return {
    received: (swaps ?? []).filter((row) => String(row.target_user_id) === actor.id && String(row.status) !== 'pending_approval'),
    sent: (swaps ?? []).filter((row) => String(row.requester_id) === actor.id && String(row.status) !== 'pending_approval'),
    sales: (sales ?? []).filter((row) => !actor.isScheduler || String(row.status) !== 'pending_approval'),
    approvals: { swaps: approvalSwaps, sales: approvalSales },
  }
}
