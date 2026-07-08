import { describe, expect, it } from 'vitest'
import {
  addDays, bangkokTomorrowString, datesOfMonth, dayOfWeek, isWeekend,
  mondayOfWeek, monthRange, nextMonth, previousMonth, thaiMonthLabel, thaiShortDate, timeToMinutes, toBE,
} from '@/lib/dates'

describe('dates', () => {
  it('converts to Buddhist era', () => {
    expect(toBE(2026)).toBe(2569)
    expect(thaiMonthLabel('2026-08')).toBe('สิงหาคม 2569')
    expect(thaiShortDate('2026-02-05')).toBe('5 ก.พ. 69')
  })

  it('computes month days and adjacent months', () => {
    expect(datesOfMonth('2026-02')).toHaveLength(28)
    expect(datesOfMonth('2028-02')).toHaveLength(29)
    expect(datesOfMonth('2026-08')[0]).toBe('2026-08-01')
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(nextMonth('2026-12')).toBe('2027-01')
  })

  it('handles weekdays and weeks', () => {
    // 2026-07-07 is a Tuesday
    expect(dayOfWeek('2026-07-07')).toBe(2)
    expect(isWeekend('2026-07-11')).toBe(true)
    expect(mondayOfWeek('2026-07-07')).toBe('2026-07-06')
    expect(mondayOfWeek('2026-07-12')).toBe('2026-07-06') // Sunday belongs to prior Monday's week
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01')
  })

  it('builds month ranges (fiscal-style spans)', () => {
    expect(monthRange('2025-10', '2026-03')).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
    ])
  })

  it('computes Bangkok tomorrow across UTC midnight', () => {
    // 2026-07-07T18:30Z = 2026-07-08 01:30 Bangkok → tomorrow = 2026-07-09
    expect(bangkokTomorrowString(new Date('2026-07-07T18:30:00Z'))).toBe('2026-07-09')
    // 2026-07-07T10:00Z = 17:00 Bangkok → tomorrow = 2026-07-08
    expect(bangkokTomorrowString(new Date('2026-07-07T10:00:00Z'))).toBe('2026-07-08')
  })

  it('parses times', () => {
    expect(timeToMinutes('16:00:00')).toBe(960)
    expect(timeToMinutes('00:00')).toBe(0)
  })
})
