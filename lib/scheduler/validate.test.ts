import { describe, expect, it } from 'vitest'
import { makeDays, makeSlots } from '@/lib/scheduler/fixtures'
import { DEFAULT_CONFIG, type AssignmentDraft } from '@/lib/scheduler/types'
import { validateAssignments, type ValidateContext } from '@/lib/scheduler/validate'

function ctx(overrides: Partial<ValidateContext> = {}): ValidateContext {
  return {
    days: makeDays('2026-08'),
    slots: makeSlots(0), // required 0 → coverage checks quiet unless overridden
    unavailable: {},
    config: DEFAULT_CONFIG,
    ...overrides,
  }
}

function a(date: string, code: string, userId: string): AssignmentDraft {
  const shiftTypeId = code === 'M' ? 'st-m' : code === 'A' ? 'st-a' : 'st-n'
  return { date, code, shiftTypeId, userId, jobId: null }
}

describe('validateAssignments', () => {
  it('flags understaffed days', () => {
    const violations = validateAssignments(ctx({ slots: makeSlots(2) }), [a('2026-08-03', 'A', 'u01')])
    expect(violations.some((v) => v.rule === 'understaffed' && v.date === '2026-08-03' && v.shiftTypeCode === 'A')).toBe(true)
  })

  it('flags assignment on a leave day', () => {
    const violations = validateAssignments(
      ctx({ unavailable: { u01: ['2026-08-03'] } }),
      [a('2026-08-03', 'A', 'u01')],
    )
    expect(violations.some((v) => v.rule === 'leave' && v.userId === 'u01')).toBe(true)
  })

  it('flags more than 16 contiguous hours (N + implicit regular M + A chain)', () => {
    const violations = validateAssignments(ctx(), [
      a('2026-08-03', 'N', 'u01'),
      a('2026-08-03', 'A', 'u01'),
    ])
    expect(violations.some((v) => v.rule === 'max_consecutive_hours')).toBe(true)
  })

  it('flags doubles when the toggle is off but allows them when on', () => {
    // Weekend A→N has no implicit regular 08:00–16:00 work between it.
    const double = [a('2026-08-08', 'A', 'u01'), a('2026-08-09', 'N', 'u01')]
    const strict = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, allowAfternoonNightDouble: false, requireWeeklyDayOff: false } }),
      double,
    )
    expect(strict.some((v) => v.rule === 'double_shift')).toBe(true)

    const lenient = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, requireWeeklyDayOff: false } }),
      double,
    )
    expect(lenient.filter((v) => v.severity === 'error')).toEqual([])
  })

  it('always blocks a Sunday A-to-Monday N double because Monday regular work makes 24 hours', () => {
    const sundayDouble = [
      a('2026-08-09', 'A', 'u01'),
      a('2026-08-10', 'N', 'u01'),
    ]
    const violations = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, allowAfternoonNightDouble: true, requireWeeklyDayOff: false } }),
      sundayDouble,
    )

    expect(violations.some((v) => v.rule === 'max_consecutive_hours')).toBe(true)
  })

  it('counts implicit weekday 08:00–16:00 regular work toward the 16-hour cap', () => {
    // Regular M + Monday A is exactly 16 hours and remains legal even when
    // OT doubles are disabled (there is only one OT assignment).
    const exactly16 = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, allowAfternoonNightDouble: false } }),
      [a('2026-08-03', 'A', 'u01')],
    )
    expect(exactly16.filter((v) => v.severity === 'error')).toEqual([])

    const nightThenRegular = validateAssignments(ctx(), [a('2026-08-03', 'N', 'u01')])
    expect(nightThenRegular.filter((v) => v.severity === 'error')).toEqual([])

    // Monday regular M + A + Tuesday N + Tuesday regular M would be a
    // continuous 32-hour chain, so it must always be rejected.
    const over16 = validateAssignments(ctx(), [
      a('2026-08-03', 'A', 'u01'),
      a('2026-08-04', 'N', 'u01'),
    ])
    expect(over16.some((v) => v.rule === 'max_consecutive_hours')).toBe(true)
  })

  it('flags insufficient rest after a night shift', () => {
    const violations = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, minRestHoursAfterNight: 12 } }),
      [a('2026-08-03', 'N', 'u01'), a('2026-08-03', 'A', 'u01')], // 8h gap < 12h required
    )
    expect(violations.some((v) => v.rule === 'rest_after_night')).toBe(true)
  })

  it('flags exceeding max shifts per month', () => {
    const violations = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, maxShiftsPerMonth: 2 } }),
      [a('2026-08-03', 'A', 'u01'), a('2026-08-05', 'A', 'u01'), a('2026-08-07', 'A', 'u01')],
    )
    expect(violations.some((v) => v.rule === 'max_shifts')).toBe(true)
  })

  it('flags a week with no day off', () => {
    // 2026-08-03 (Mon) … 2026-08-09 (Sun) fully worked
    const week = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
    const violations = validateAssignments(ctx(), week.map((d) => a(d, 'A', 'u01')))
    expect(violations.some((v) => v.rule === 'weekly_day_off')).toBe(true)
  })

  it('flags overlapping shifts', () => {
    const violations = validateAssignments(ctx(), [
      a('2026-08-03', 'A', 'u01'),
      { date: '2026-08-03', code: 'A4', shiftTypeId: 'st-a4', userId: 'u01', jobId: null },
    ])
    // A4 is not in slots list; add it
    const withA4 = validateAssignments(
      ctx({
        slots: [
          ...makeSlots(0),
          { shiftTypeId: 'st-a4', code: 'A4', startMin: 960, endMin: 1200, hours: 4, requiredByDayClass: { weekday: 0, weekend: 0, holiday: 0 } },
        ],
      }),
      [
        a('2026-08-03', 'A', 'u01'),
        { date: '2026-08-03', code: 'A4', shiftTypeId: 'st-a4', userId: 'u01', jobId: null },
      ],
    )
    expect(withA4.some((v) => v.rule === 'overlap')).toBe(true)
    expect(violations).toBeDefined()
  })
})
