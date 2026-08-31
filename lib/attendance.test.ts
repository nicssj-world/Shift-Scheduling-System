import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_CODE_BY_EXCEL,
  addAttendanceTotal,
  emptyAttendanceTotals,
  expandIsoDateRange,
  fiscalYearForDate,
  fiscalYearRange,
  isIsoDate,
  isIsoMonth,
  isWeekendIsoDate,
  thaiFiscalYear,
} from '@/lib/attendance'
import { ATTENDANCE_CODES, ATTENDANCE_REPORT_CATEGORIES } from '@/lib/types'
import { datesOfMonth } from '@/lib/dates'

describe('attendance register helpers', () => {
  it('maps every workbook code to a daily register code', () => {
    expect(Object.keys(ATTENDANCE_CODE_BY_EXCEL)).toHaveLength(10)
    expect(ATTENDANCE_CODES).toHaveLength(10)
    expect(ATTENDANCE_CODE_BY_EXCEL['พ']).toBe('vacation')
    expect(ATTENDANCE_CODE_BY_EXCEL['ป/2']).toBe('sick_half')
    expect(ATTENDANCE_CODE_BY_EXCEL['ก/2']).toBe('personal_half')
    expect(ATTENDANCE_CODE_BY_EXCEL['พ/2']).toBe('vacation_half')
    expect(ATTENDANCE_CODE_BY_EXCEL['ค']).toBe('maternity')
  })

  it('validates ISO dates and calendar month shapes, including leap years', () => {
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoMonth('2026-13')).toBe(false)
    expect(datesOfMonth('2024-02')).toHaveLength(29)
    expect(datesOfMonth('2026-04')).toHaveLength(30)
    expect(datesOfMonth('2026-08')).toHaveLength(31)
    expect(isWeekendIsoDate('2026-08-08')).toBe(true)
    expect(isWeekendIsoDate('2026-08-09')).toBe(true)
    expect(isWeekendIsoDate('2026-08-10')).toBe(false)
  })

  it('expands a range without excluding weekends or holidays', () => {
    expect(expandIsoDateRange('2026-08-07', '2026-08-10')).toEqual([
      '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10',
    ])
    expect(expandIsoDateRange('2026-08-10', '2026-08-07')).toEqual([])
  })

  it('resolves Thai fiscal-year ranges at the October boundary', () => {
    expect(fiscalYearForDate('2026-09-30')).toBe(2026)
    expect(fiscalYearForDate('2026-10-01')).toBe(2027)
    expect(fiscalYearRange(2026)).toEqual({ from: '2025-10-01', to: '2026-09-30' })
    expect(thaiFiscalYear(2026)).toBe(2569)
  })

  it('counts half-day codes as 0.5 and late/early as occurrences', () => {
    const totals = emptyAttendanceTotals()
    addAttendanceTotal(totals, 'vacation_half')
    addAttendanceTotal(totals, 'sick_half')
    addAttendanceTotal(totals, 'personal_half')
    addAttendanceTotal(totals, 'late')
    addAttendanceTotal(totals, 'early')
    addAttendanceTotal(totals, 'maternity')
    expect(totals).toEqual({ vacation: 0.5, sick: 0.5, personal: 0.5, absent: 0, late: 1, early: 1, maternity: 1 })
    expect(Object.keys(totals)).toHaveLength(ATTENDANCE_REPORT_CATEGORIES.length)
  })
})
