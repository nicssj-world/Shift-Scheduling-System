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

  it('enforces 16-hour OT rest even when the legacy double toggle is on', () => {
    // Weekend A→N has no implicit regular 08:00–16:00 work between it, but
    // the two OT shifts still have zero recovery hours.
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
    expect(lenient.some((v) => v.rule === 'minimum_rest_between_ot')).toBe(true)
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

  it('flags insufficient rest between any two OT shifts', () => {
    const violations = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, minRestHoursAfterNight: 12 } }),
      [a('2026-08-03', 'N', 'u01'), a('2026-08-03', 'A', 'u01')], // 8h gap < the global 16h minimum
    )
    expect(violations.some((v) => v.rule === 'minimum_rest_between_ot')).toBe(true)
  })

  it('does not apply the OT rest rule to implicit regular work', () => {
    const violations = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, minRestHoursAfterNight: 12 } }),
      [a('2026-08-03', 'N', 'u01')],
    )
    expect(violations.some((v) => v.rule === 'minimum_rest_between_ot')).toBe(false)
  })

  it('applies the OT rest rule even when a midnight-start shift is not marked as night', () => {
    const slots = makeSlots(0).map((slot) => slot.code === 'N'
      ? { ...slot, triggersRestAfterNight: false }
      : slot)
    const violations = validateAssignments(
      ctx({ slots, config: { ...DEFAULT_CONFIG, minRestHoursAfterNight: 12, requireWeeklyDayOff: false } }),
      [a('2026-08-03', 'N', 'u01'), a('2026-08-03', 'A', 'u01')],
    )
    expect(violations.some((v) => v.rule === 'minimum_rest_between_ot')).toBe(true)
  })

  it('flags consecutive night shifts even though they have exactly 16 hours between them', () => {
    const violations = validateAssignments(
      ctx({ config: { ...DEFAULT_CONFIG, requireWeeklyDayOff: false } }),
      [a('2026-08-03', 'N', 'u01'), a('2026-08-04', 'N', 'u01')],
    )
    expect(violations.some((v) => v.rule === 'consecutive_night')).toBe(true)
  })

  it('warns when holiday duty is concentrated on one person', () => {
    const violations = validateAssignments(ctx({
      days: [
        { date: '2026-10-13', dayClass: 'holiday' },
        { date: '2026-10-23', dayClass: 'holiday' },
      ],
      members: [{ userId: 'u01' }, { userId: 'u02' }],
      exactCoverage: false,
      config: { ...DEFAULT_CONFIG, requireWeeklyDayOff: false },
    }), [
      a('2026-10-13', 'A', 'u01'),
      a('2026-10-23', 'A', 'u01'),
    ])
    expect(violations.some((v) => v.rule === 'holiday_imbalance' && v.severity === 'warning')).toBe(true)
  })

  it('warns when one shift type is concentrated on one person', () => {
    const slot = {
      ...makeSlots(0).find((item) => item.code === 'A')!,
      requiredByDayClass: { weekday: 1, weekend: 0, holiday: 0 } as const,
    }
    const violations = validateAssignments(ctx({
      days: [
        { date: '2026-08-03', dayClass: 'weekday' },
        { date: '2026-08-04', dayClass: 'weekday' },
      ],
      slots: [slot],
      members: [{ userId: 'u01' }, { userId: 'u02' }],
      exactCoverage: false,
      config: { ...DEFAULT_CONFIG, requireWeeklyDayOff: false },
    }), [
      a('2026-08-03', 'A', 'u01'),
      a('2026-08-04', 'A', 'u01'),
    ])
    expect(violations.some((v) => v.rule === 'type_imbalance' && v.shiftTypeCode === 'A' && v.severity === 'warning')).toBe(true)
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

  it('flags structural assignment errors in production validation mode', () => {
    const slots = makeSlots(0).map((slot) => slot.code === 'A' ? { ...slot, requiredByDayClass: { weekday: 0, weekend: 0, holiday: 0 } } : slot)
    const violations = validateAssignments({
      ...ctx({ slots, exactCoverage: true }),
      shiftTypes: [
        { id: 'st-a', code: 'A', isActive: true },
        { id: 'st-old', code: 'OLD', isActive: false },
      ],
      members: [{ userId: 'u01', isActive: true }],
      jobs: [{ id: 'job-1', code: 'J1', sortOrder: 1 }],
      usesJobs: true,
    }, [
      a('2026-08-03', 'A', 'u02'),
      { ...a('2026-08-04', 'OLD', 'u01'), shiftTypeId: 'st-old' },
      { ...a('2026-08-05', 'A', 'u01'), jobId: 'bad-job' },
      { ...a('2026-09-01', 'A', 'u01') },
    ])

    expect(violations.map((violation) => violation.rule)).toEqual(expect.arrayContaining([
      'non_team_member', 'inactive_shift', 'invalid_job', 'date_out_of_range',
    ]))
  })

  it('treats overstaffing on a zero-requirement slot as an error in exact mode', () => {
    const violations = validateAssignments({ ...ctx({ exactCoverage: true }), slots: makeSlots(0) }, [a('2026-08-03', 'A', 'u01')])
    expect(violations.some((violation) => violation.rule === 'overstaffed' && violation.severity === 'error')).toBe(true)
  })

  it('requires one distinct active Job for every required position', () => {
    const slot = makeSlots(2).find((item) => item.code === 'A')!
    const violations = validateAssignments({
      ...ctx({ days: [{ date: '2026-08-03', dayClass: 'weekday' }], slots: [slot], exactCoverage: true }),
      shiftTypes: [{ id: slot.shiftTypeId, code: slot.code, isActive: true }],
      members: [{ userId: 'u01' }, { userId: 'u02' }],
      jobs: [{ id: 'job-1', code: 'J1', sortOrder: 1 }, { id: 'job-2', code: 'J2', sortOrder: 2 }],
      usesJobs: true,
    }, [
      { ...a('2026-08-03', 'A', 'u01'), jobId: 'job-1' },
      { ...a('2026-08-03', 'A', 'u02'), jobId: 'job-1' },
    ])
    expect(violations.some((violation) => violation.rule === 'job_coverage')).toBe(true)
  })

  it('checks the first week across the previous-month boundary', () => {
    const days = [
      { date: '2026-08-01', dayClass: 'weekend' as const },
      { date: '2026-08-02', dayClass: 'weekend' as const },
      { date: '2026-08-03', dayClass: 'weekday' as const },
      { date: '2026-08-04', dayClass: 'weekday' as const },
      { date: '2026-08-05', dayClass: 'weekday' as const },
      { date: '2026-08-06', dayClass: 'weekday' as const },
      { date: '2026-08-07', dayClass: 'weekday' as const },
    ]
    const violations = validateAssignments({
      ...ctx({ days, config: { ...DEFAULT_CONFIG, requireWeeklyDayOff: true } }),
      carryIn: {
        assignments: { u01: [{ date: '2026-07-27', code: 'A' }, { date: '2026-07-28', code: 'A' }, { date: '2026-07-29', code: 'A' }, { date: '2026-07-30', code: 'A' }, { date: '2026-07-31', code: 'A' }] },
        shiftTypeCounts: {}, jobCounts: {}, weekendHolidayCounts: {}, pairCounts: {},
        regularWorkDates: [], totalCounts: {},
      },
    }, days.map((day) => a(day.date, 'A', 'u01')))
    expect(violations.some((violation) => violation.rule === 'weekly_day_off')).toBe(true)
  })

  it('counts approved boundary leave as the weekly day off', () => {
    const violations = validateAssignments({
      ...ctx({ unavailable: { u01: ['2026-07-31'] } }),
      carryIn: {
        assignments: {},
        shiftTypeCounts: {}, jobCounts: {}, weekendHolidayCounts: {}, pairCounts: {},
        regularWorkDates: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'],
        totalCounts: {},
      },
    }, [a('2026-08-01', 'A', 'u01'), a('2026-08-02', 'A', 'u01')])
    expect(violations.some((violation) => violation.rule === 'weekly_day_off')).toBe(false)
  })

  it('treats a stale assignment on approved leave as a day off for weekly rest', () => {
    const week = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
    const violations = validateAssignments({
      ...ctx({ unavailable: { u01: ['2026-08-05'] } }),
      carryIn: {
        assignments: {}, shiftTypeCounts: {}, jobCounts: {}, weekendHolidayCounts: {}, pairCounts: {},
        regularWorkDates: [], totalCounts: {},
      },
    }, week.map((date) => a(date, 'A', 'u01')))
    expect(violations.some((violation) => violation.rule === 'leave')).toBe(true)
    expect(violations.some((violation) => violation.rule === 'weekly_day_off')).toBe(false)
  })

  it('does not warn when a trailing boundary week cannot yet be proven', () => {
    const violations = validateAssignments(ctx({ config: { ...DEFAULT_CONFIG, requireWeeklyDayOff: true } }), [
      a('2026-08-03', 'A', 'u01'),
    ])
    expect(violations.some((violation) => violation.rule === 'weekly_day_off_pending')).toBe(false)
  })

  it('does not require a future roster for active team members', () => {
    const violations = validateAssignments(ctx({
      config: { ...DEFAULT_CONFIG, requireWeeklyDayOff: true },
      members: [{ userId: 'u01' }, { userId: 'u02' }, { userId: 'u03' }],
    }), [])
    const pending = violations.filter((violation) => violation.rule === 'weekly_day_off_pending')

    expect(pending).toEqual([])
  })

  it('hard-checks a trailing boundary week once the next roster is known', () => {
    const nextDates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']
    const violations = validateAssignments({
      ...ctx({ config: { ...DEFAULT_CONFIG, requireWeeklyDayOff: true } }),
      carryIn: {
        assignments: {},
        futureAssignments: { u01: nextDates.map((date) => ({ date, code: 'A' })) },
        futureKnownDates: nextDates,
        shiftTypeCounts: {}, jobCounts: {}, weekendHolidayCounts: {}, pairCounts: {},
        regularWorkDates: [], futureRegularWorkDates: [], totalCounts: {},
      },
    }, [a('2026-08-31', 'A', 'u01')])
    expect(violations.some((violation) => violation.rule === 'weekly_day_off' && violation.date === '2026-08-31')).toBe(true)
    expect(violations.some((violation) => violation.rule === 'weekly_day_off_pending')).toBe(false)
  })
})
