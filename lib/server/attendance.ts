import 'server-only'

import { datesOfMonth } from '@/lib/dates'
import {
  ATTENDANCE_CODES,
  type AttendanceCode,
  type AttendanceRecord,
  type Holiday,
  type LeaveRecorder,
  normalizeRole,
  type Role,
} from '@/lib/types'
import { getAdminClient } from '@/lib/supabase/admin'
import { HttpError } from '@/lib/server/errors'
import { emptyAttendanceTotals, fiscalYearRange, isWeekendIsoDate, type AttendanceReportRow } from '@/lib/attendance'
import { getHolidays } from '@/lib/server/data'
import type { Actor } from '@/lib/types'

type ProfileRecord = {
  id: string
  ephis_id: string | null
  name: string
  role: string | null
  dept: string | null
  phone: string | null
  position_title: string | null
  employment_type: string | null
  status?: string | null
  deleted_at?: string | null
}

export type AttendancePerson = {
  id: string
  ephis_id: string | null
  name: string
  role: Role
  dept: string | null
  phone: string | null
  position_title: string | null
  employment_type: string | null
  isActive: boolean
}

export type AttendanceRecordView = AttendanceRecord & {
  userName: string
  userDept: string | null
  positionTitle: string | null
  employmentType: string | null
}

export type AttendanceGridData = {
  month: string
  people: AttendancePerson[]
  availablePeople: AttendancePerson[]
  records: AttendanceRecordView[]
  holidays: Holiday[]
}

export type AttendanceHistoryData = {
  records: AttendanceRecordView[]
  totals: AttendanceReportRow | null
  nextCursor: string | null
}

export type VacationBalanceView = {
  userId: string
  name: string
  dept: string | null
  positionTitle: string | null
  employmentType: string | null
  fiscalYear: number
  previousDays: number
  currentDays: number
  totalDays: number
  usedDays: number
  remainingDays: number
  updatedAt: string | null
}

export type VacationBalancesData = {
  fiscalYear: number
  from: string
  to: string
  rows: VacationBalanceView[]
}

const PROFILE_FIELDS = 'id,ephis_id,name,role,dept,phone,position_title,employment_type,status,deleted_at'

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function toPerson(row: ProfileRecord): AttendancePerson {
  const status = String(row.status ?? 'active').toLowerCase()
  return {
    id: String(row.id),
    ephis_id: toNullableString(row.ephis_id),
    name: String(row.name ?? ''),
    role: normalizeRole(row.role),
    dept: toNullableString(row.dept),
    phone: toNullableString(row.phone),
    position_title: toNullableString(row.position_title),
    employment_type: toNullableString(row.employment_type),
    isActive: status === 'active' && !row.deleted_at,
  }
}

function toRecord(row: Record<string, unknown>, people: Map<string, AttendancePerson>): AttendanceRecordView | null {
  const code = String(row.code ?? '')
  const userId = String(row.user_id ?? '')
  if (!userId || !(ATTENDANCE_CODES as readonly string[]).includes(code)) return null
  const person = people.get(userId)
  return {
    id: String(row.id),
    user_id: userId,
    record_date: String(row.record_date),
    code: code as AttendanceCode,
    note: toNullableString(row.note),
    source: row.source === 'excel' ? 'excel' : 'manual',
    source_ref: toNullableString(row.source_ref),
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    updated_by: toNullableString(row.updated_by),
    updated_at: String(row.updated_at),
    deleted_by: toNullableString(row.deleted_by),
    deleted_at: toNullableString(row.deleted_at),
    userName: person?.name ?? '',
    userDept: person?.dept ?? null,
    positionTitle: person?.position_title ?? null,
    employmentType: person?.employment_type ?? null,
  }
}

async function loadProfiles(ids?: string[], includeInactive = false): Promise<AttendancePerson[]> {
  const admin = getAdminClient()
  let query = admin.from('profiles').select(PROFILE_FIELDS).order('name')
  if (ids && ids.length > 0) query = query.in('id', ids)
  const { data, error } = await query
  if (error) throw new HttpError(500, error.message)
  return ((data ?? []) as unknown as ProfileRecord[])
    .map(toPerson)
    .filter((person) => includeInactive || person.isActive)
}

async function recordViews(rows: Record<string, unknown>[]): Promise<AttendanceRecordView[]> {
  const ids = [...new Set(rows.map((row) => String(row.user_id ?? '')).filter(Boolean))]
  const people = new Map((await loadProfiles(ids, true)).map((person) => [person.id, person]))
  return rows.map((row) => toRecord(row, people)).filter((row): row is AttendanceRecordView => Boolean(row))
}

export async function getAttendanceDirectory(): Promise<AttendancePerson[]> {
  return loadProfiles()
}

export async function canManageAttendance(actor: Pick<Actor, 'id' | 'role'>): Promise<boolean> {
  if (actor.role === 'Admin') return true
  const { data, error } = await getAdminClient()
    .from('shift_leave_recorders')
    .select('user_id')
    .eq('user_id', actor.id)
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  return Boolean(data)
}

export async function getAttendanceGrid(month: string): Promise<AttendanceGridData> {
  const dates = datesOfMonth(month)
  const [allPeople, holidays] = await Promise.all([
    loadProfiles(),
    getHolidays(dates[0], dates[dates.length - 1]),
  ])
  const { data: rosterRows, error: rosterError } = await getAdminClient()
    .from('shift_leave_roster')
    .select('user_id')
    .is('removed_at', null)
    .order('added_at')
  if (rosterError) throw new HttpError(500, rosterError.message)
  const rosterIds = (rosterRows ?? []).map((row) => String(row.user_id))
  const rosterIdSet = new Set(rosterIds)
  const people = allPeople.filter((person) => rosterIdSet.has(person.id))
  const availablePeople = allPeople.filter((person) => !rosterIdSet.has(person.id))

  let records: AttendanceRecordView[] = []
  if (rosterIds.length > 0) {
    const { data, error } = await getAdminClient()
      .from('shift_attendance_records')
      .select('*')
      .is('deleted_at', null)
      .in('user_id', rosterIds)
      .gte('record_date', dates[0])
      .lte('record_date', dates[dates.length - 1])
      .order('record_date')
      .order('user_id')
    if (error) throw new HttpError(500, error.message)
    records = await recordViews((data ?? []) as Record<string, unknown>[])
  }
  return { month, people, availablePeople, records, holidays }
}

export async function assertAttendanceDatesOpen(dates: string[]) {
  if (dates.length === 0) return
  const sorted = [...dates].sort()
  const holidays = await getHolidays(sorted[0], sorted[sorted.length - 1])
  const holidayDates = new Set(holidays.map((holiday) => holiday.holiday_date))
  const blocked = sorted.filter((date) => isWeekendIsoDate(date) || holidayDates.has(date))
  if (blocked.length > 0) {
    throw new HttpError(400, `ไม่สามารถบันทึกวันเสาร์–อาทิตย์หรือวันหยุดได้: ${blocked.join(', ')}`)
  }
}

export async function getVacationBalances(fiscalYear: number): Promise<VacationBalancesData> {
  const admin = getAdminClient()
  const range = fiscalYearRange(fiscalYear)
  const [allPeople, rosterResult] = await Promise.all([
    loadProfiles(),
    admin.from('shift_leave_roster')
      .select('user_id')
      .is('removed_at', null)
      .order('added_at'),
  ])
  if (rosterResult.error) throw new HttpError(500, rosterResult.error.message)

  const rosterIds = new Set((rosterResult.data ?? []).map((row) => String(row.user_id)))
  const people = allPeople.filter((person) => rosterIds.has(person.id))
  const userIds = people.map((person) => person.id)
  if (userIds.length === 0) return { fiscalYear, ...range, rows: [] }

  const [balanceResult, usageResult] = await Promise.all([
    admin.from('shift_vacation_balances')
      .select('user_id,previous_days,current_days,updated_at')
      .eq('fiscal_year', fiscalYear)
      .in('user_id', userIds),
    admin.from('shift_attendance_records')
      .select('user_id,code')
      .in('user_id', userIds)
      .in('code', ['vacation', 'vacation_half'])
      .is('deleted_at', null)
      .gte('record_date', range.from)
      .lte('record_date', range.to),
  ])
  if (balanceResult.error) throw new HttpError(500, balanceResult.error.message)
  if (usageResult.error) throw new HttpError(500, usageResult.error.message)

  const balances = new Map((balanceResult.data ?? []).map((row) => [String(row.user_id), row]))
  const usedByUser = new Map<string, number>()
  for (const row of usageResult.data ?? []) {
    const userId = String(row.user_id)
    const value = row.code === 'vacation_half' ? 0.5 : 1
    usedByUser.set(userId, (usedByUser.get(userId) ?? 0) + value)
  }

  return {
    fiscalYear,
    ...range,
    rows: people.map((person) => {
      const balance = balances.get(person.id)
      const previousDays = Number(balance?.previous_days ?? 0)
      const currentDays = Number(balance?.current_days ?? 0)
      const totalDays = previousDays + currentDays
      const usedDays = usedByUser.get(person.id) ?? 0
      return {
        userId: person.id,
        name: person.name,
        dept: person.dept,
        positionTitle: person.position_title,
        employmentType: person.employment_type,
        fiscalYear,
        previousDays,
        currentDays,
        totalDays,
        usedDays,
        remainingDays: totalDays - usedDays,
        updatedAt: balance?.updated_at ? String(balance.updated_at) : null,
      }
    }),
  }
}

export async function upsertVacationBalance(
  userId: string,
  fiscalYear: number,
  previousDays: number,
  currentDays: number,
  actorId: string,
) {
  const admin = getAdminClient()
  const [{ data: person, error: personError }, { data: roster, error: rosterError }] = await Promise.all([
    admin.from('profiles').select('id,status,deleted_at').eq('id', userId).maybeSingle(),
    admin.from('shift_leave_roster').select('user_id').eq('user_id', userId).is('removed_at', null).maybeSingle(),
  ])
  if (personError) throw new HttpError(500, personError.message)
  if (rosterError) throw new HttpError(500, rosterError.message)
  if (!person) throw new HttpError(404, 'ไม่พบบุคลากรที่เลือก')
  if (String(person.status ?? 'active').toLowerCase() !== 'active' || person.deleted_at) {
    throw new HttpError(400, 'แก้ไขสิทธิ์ได้เฉพาะบุคลากรที่ยัง active')
  }
  if (!roster) throw new HttpError(400, 'กรุณาเพิ่มบุคลากรเข้าทะเบียนก่อนบันทึกสิทธิ์พักร้อน')

  const { data: existing, error: existingError } = await admin
    .from('shift_vacation_balances')
    .select('user_id')
    .eq('user_id', userId)
    .eq('fiscal_year', fiscalYear)
    .maybeSingle()
  if (existingError) throw new HttpError(500, existingError.message)

  const now = new Date().toISOString()
  const payload = {
    previous_days: previousDays,
    current_days: currentDays,
    updated_by: actorId,
    updated_at: now,
  }
  const result = existing
    ? await admin.from('shift_vacation_balances')
      .update(payload)
      .eq('user_id', userId)
      .eq('fiscal_year', fiscalYear)
    : await admin.from('shift_vacation_balances').insert({
      user_id: userId,
      fiscal_year: fiscalYear,
      ...payload,
      created_by: actorId,
      created_at: now,
    })
  if (result.error) throw new HttpError(500, result.error.message)
  return { userId, fiscalYear, previousDays, currentDays }
}

export async function addAttendanceRosterPerson(userId: string, actorId: string) {
  const admin = getAdminClient()
  const { data: person, error: personError } = await admin
    .from('profiles')
    .select('id,status,deleted_at')
    .eq('id', userId)
    .maybeSingle()
  if (personError) throw new HttpError(500, personError.message)
  if (!person) throw new HttpError(404, 'ไม่พบบุคลากรที่เลือก')
  if (String(person.status ?? 'active').toLowerCase() !== 'active' || person.deleted_at) {
    throw new HttpError(400, 'เพิ่มได้เฉพาะบุคลากรที่ยัง active')
  }

  const { data: existing, error: existingError } = await admin
    .from('shift_leave_roster')
    .select('user_id,removed_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (existingError) throw new HttpError(500, existingError.message)
  if (existing && !existing.removed_at) throw new HttpError(409, 'บุคลากรนี้อยู่ในทะเบียนอยู่แล้ว')

  const now = new Date().toISOString()
  const { error } = await admin.from('shift_leave_roster').upsert({
    user_id: userId,
    added_by: actorId,
    added_at: now,
    updated_by: actorId,
    updated_at: now,
    removed_by: null,
    removed_at: null,
  }, { onConflict: 'user_id' })
  if (error) throw new HttpError(500, error.message)
  return { userId }
}

export async function removeAttendanceRosterPerson(userId: string, actorId: string) {
  const now = new Date().toISOString()
  const { data, error } = await getAdminClient()
    .from('shift_leave_roster')
    .update({ removed_by: actorId, removed_at: now, updated_by: actorId, updated_at: now })
    .eq('user_id', userId)
    .is('removed_at', null)
    .select('user_id')
    .maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!data) throw new HttpError(404, 'ไม่พบบุคลากรในทะเบียน หรือถูกนำออกจากทะเบียนแล้ว')
  return { userId }
}

export async function getAttendanceHistory(
  userId: string,
  from: string | null,
  to: string | null,
  cursor: string | null,
  limit = 50,
): Promise<AttendanceHistoryData> {
  const admin = getAdminClient()
  let query = admin.from('shift_attendance_records')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('record_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (from) query = query.gte('record_date', from)
  if (to) query = query.lte('record_date', to)
  if (cursor) {
    const [cursorDate, cursorId] = cursor.split('|')
    if (cursorDate && cursorId) {
      query = query.or(`record_date.lt.${cursorDate},and(record_date.eq.${cursorDate},id.lt.${cursorId})`)
    }
  }
  const { data, error } = await query
  if (error) throw new HttpError(500, error.message)
  const rawRows = ((data ?? []) as Record<string, unknown>[])
  const hasMore = rawRows.length > limit
  const rows = hasMore ? rawRows.slice(0, limit) : rawRows
  const records = await recordViews(rows)

  let totals: AttendanceReportRow | null = null
  if (!cursor) {
    const reportFrom = from ?? '1900-01-01'
    const reportTo = to ?? '2999-12-31'
    const { data: reportRows, error: reportError } = await admin.rpc('shift_attendance_report', {
      p_from: reportFrom,
      p_to: reportTo,
    })
    if (reportError) throw new HttpError(500, reportError.message)
    const row = ((reportRows ?? []) as Record<string, unknown>[]).find((item) => String(item.user_id) === userId)
    if (row) totals = toReportRow(row)
  }

  const last = records[records.length - 1]
  return {
    records,
    totals,
    nextCursor: hasMore && last ? `${last.record_date}|${last.id}` : null,
  }
}

export async function getAttendanceReport(from: string, to: string): Promise<AttendanceReportRow[]> {
  const admin = getAdminClient()
  const [reportResult, rosterResult, activePeople] = await Promise.all([
    admin.rpc('shift_attendance_report', { p_from: from, p_to: to }),
    admin.from('shift_leave_roster').select('user_id').is('removed_at', null),
    loadProfiles(),
  ])
  if (reportResult.error) throw new HttpError(500, reportResult.error.message)
  if (rosterResult.error) throw new HttpError(500, rosterResult.error.message)

  // Keep the report in sync with the people currently visible in /leaves.
  // The database RPC also retains historical inactive profiles for audit use,
  // but those people are no longer part of the register table.
  const rosterIds = new Set((rosterResult.data ?? []).map((row) => String(row.user_id)))
  const tableIds = new Set(activePeople.filter((person) => rosterIds.has(person.id)).map((person) => person.id))
  return ((reportResult.data ?? []) as Record<string, unknown>[])
    .filter((row) => tableIds.has(String(row.user_id)))
    .map(toReportRow)
}

export async function getAttendanceMonthlyTotals(from: string, to: string): Promise<Array<{ month: string; total: number; late: number; early: number }>> {
  const { data, error } = await getAdminClient().rpc('shift_attendance_monthly_totals', {
    p_from: from,
    p_to: to,
  })
  if (error) throw new HttpError(500, error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    month: String(row.month).slice(0, 7),
    total: Number(row.total ?? 0),
    late: Number(row.late ?? 0),
    early: Number(row.early ?? 0),
  }))
}

export async function getLeaveRecorders(): Promise<LeaveRecorder[]> {
  const admin = getAdminClient()
  const { data, error } = await admin.from('shift_leave_recorders').select('user_id,granted_by,created_at').order('created_at')
  if (error) throw new HttpError(500, error.message)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const ids = rows.map((row) => String(row.user_id))
  const people = new Map((await loadProfiles(ids, true)).map((person) => [person.id, person]))
  return rows.map((row) => ({
    user_id: String(row.user_id),
    name: people.get(String(row.user_id))?.name ?? '',
    dept: people.get(String(row.user_id))?.dept ?? null,
    granted_by: String(row.granted_by),
    created_at: String(row.created_at),
  }))
}

export function toReportRow(row: Record<string, unknown>): AttendanceReportRow {
  const totals = emptyAttendanceTotals()
  for (const key of Object.keys(totals)) totals[key as keyof typeof totals] = Number(row[key] ?? 0)
  return {
    userId: String(row.user_id),
    name: String(row.name ?? ''),
    dept: toNullableString(row.dept),
    positionTitle: toNullableString(row.position_title),
    employmentType: toNullableString(row.employment_type),
    ...totals,
  }
}
