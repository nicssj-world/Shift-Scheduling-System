import {
  ATTENDANCE_CODE_VALUES,
  ATTENDANCE_REPORT_CATEGORIES,
  attendanceReportCategory,
  attendanceReportValue,
  type AttendanceCode,
  type AttendanceReportCategory,
} from '@/lib/types'

export const ATTENDANCE_CODE_BY_EXCEL: Record<string, AttendanceCode> = {
  'พ': 'vacation',
  'ป': 'sick',
  'ป/2': 'sick_half',
  'ก': 'personal',
  'ก/2': 'personal_half',
  'ข': 'absent',
  'ส': 'late',
  'บ': 'early',
  'พ/2': 'vacation_half',
  'ค': 'maternity',
}

export { ATTENDANCE_CODE_VALUES }

export type AttendanceReportRow = {
  userId: string
  name: string
  dept: string | null
  positionTitle: string | null
  employmentType: string | null
} & Record<AttendanceReportCategory, number>

export const ATTENDANCE_REPORT_KEYS = [...ATTENDANCE_REPORT_CATEGORIES]

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isIsoMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value) && isIsoDate(`${value}-01`)
}

export function isWeekendIsoDate(value: string): boolean {
  if (!isIsoDate(value)) return false
  const day = new Date(`${value}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

export function expandIsoDateRange(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return []
  const dates: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

/** Gregorian year in which the Thai fiscal year ends (Oct 1 - Sep 30). */
export function fiscalYearForDate(date: string): number {
  if (!isIsoDate(date)) throw new Error('Invalid ISO date')
  const year = Number(date.slice(0, 4))
  return Number(date.slice(5, 7)) >= 10 ? year + 1 : year
}

export function fiscalYearRange(fiscalYear: number): { from: string; to: string } {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2200) {
    throw new Error('Invalid fiscal year')
  }
  return {
    from: `${fiscalYear - 1}-10-01`,
    to: `${fiscalYear}-09-30`,
  }
}

export function thaiFiscalYear(fiscalYear: number): number {
  return fiscalYear + 543
}

export function emptyAttendanceTotals(): Record<AttendanceReportCategory, number> {
  return Object.fromEntries(ATTENDANCE_REPORT_CATEGORIES.map((key) => [key, 0])) as Record<AttendanceReportCategory, number>
}

export function addAttendanceTotal(
  totals: Record<AttendanceReportCategory, number>,
  code: AttendanceCode,
  amount = attendanceReportValue(code),
) {
  const category = attendanceReportCategory(code)
  totals[category] += amount
  return totals
}

export function thaiAttendanceSourceLabel(source: 'manual' | 'excel'): string {
  return source === 'excel' ? 'นำเข้าจาก Excel' : 'บันทึกโดยธุรการ'
}
