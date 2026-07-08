import { describe, expect, it } from 'vitest'
import { generateSchedule } from '@/lib/scheduler/engine'
import { FOUR_JOBS, makeDays, makeSlots, makeStaff } from '@/lib/scheduler/fixtures'
import { DEFAULT_CONFIG, EMPTY_CARRY_IN, type SchedulerInput } from '@/lib/scheduler/types'
import { validateAssignments } from '@/lib/scheduler/validate'

function baseInput(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    days: makeDays('2026-08'),
    slots: makeSlots(2),
    staff: makeStaff(12),
    unavailable: {},
    jobs: [],
    carryIn: EMPTY_CARRY_IN,
    config: DEFAULT_CONFIG,
    ...overrides,
  }
}

describe('generateSchedule', () => {
  it('fills every required slot when feasible', () => {
    const result = generateSchedule(baseInput())
    const understaffed = result.violations.filter((v) => v.rule === 'understaffed')
    expect(understaffed).toEqual([])
    // 21 weekdays ×2 slots ×2 + 10 weekend days ×3 slots ×2 = 144
    expect(result.assignments).toHaveLength(144)
  })

  it('is deterministic across runs', () => {
    const a = generateSchedule(baseInput())
    const b = generateSchedule(baseInput())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('produces no hard-constraint violations', () => {
    const input = baseInput()
    const result = generateSchedule(input)
    const errors = validateAssignments(input, result.assignments).filter((v) => v.severity === 'error')
    expect(errors).toEqual([])
  })

  it('keeps workload balanced', () => {
    const result = generateSchedule(baseInput())
    const totals = Object.values(result.stats).map((s) => s.total)
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(4)
  })

  it('respects approved leave', () => {
    const leaveDates = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']
    const input = baseInput({ unavailable: { u01: leaveDates } })
    const result = generateSchedule(input)
    const conflicting = result.assignments.filter((a) => a.userId === 'u01' && leaveDates.includes(a.date))
    expect(conflicting).toEqual([])
  })

  it('never places a morning shift right after a night shift', () => {
    const result = generateSchedule(baseInput())
    const nightByUser = new Set(result.assignments.filter((a) => a.code === 'N').map((a) => `${a.userId}|${a.date}`))
    const badMornings = result.assignments.filter(
      (a) => a.code === 'M' && nightByUser.has(`${a.userId}|${a.date}`),
    )
    expect(badMornings).toEqual([])
  })

  it('blocks afternoon+night doubles when the toggle is off', () => {
    const input = baseInput({
      config: { ...DEFAULT_CONFIG, allowAfternoonNightDouble: false },
    })
    const result = generateSchedule(input)
    const afternoonSet = new Set(result.assignments.filter((a) => a.code === 'A').map((a) => `${a.userId}|${a.date}`))
    const doubles = result.assignments.filter((a) => {
      if (a.code !== 'N') return false
      const prev = new Date(`${a.date}T00:00:00Z`)
      prev.setUTCDate(prev.getUTCDate() - 1)
      return afternoonSet.has(`${a.userId}|${prev.toISOString().slice(0, 10)}`)
    })
    expect(doubles).toEqual([])
  })

  it('respects previous-month carry-in at the boundary', () => {
    const input = baseInput({
      config: { ...DEFAULT_CONFIG, allowAfternoonNightDouble: false },
      carryIn: {
        assignments: { u01: [{ date: '2026-07-31', code: 'A' }] },
        shiftTypeCounts: {},
        jobCounts: {},
      },
    })
    const result = generateSchedule(input)
    // u01 worked A on 31 Jul → cannot take N on 1 Aug (contiguous double, toggle off)
    const bad = result.assignments.filter((a) => a.userId === 'u01' && a.date === '2026-08-01' && a.code === 'N')
    expect(bad).toEqual([])
  })

  it('rotates the four jobs evenly', () => {
    const slots = makeSlots(4).filter((s) => s.code === 'A')
    const input = baseInput({ slots, staff: makeStaff(8), jobs: FOUR_JOBS })
    const result = generateSchedule(input)

    for (const [, stats] of Object.entries(result.stats)) {
      const counts = FOUR_JOBS.map((j) => stats.byJob[j.code] ?? 0)
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2)
    }
    // every assignment got a job
    expect(result.assignments.every((a) => a.jobId !== null)).toBe(true)
  })

  it('emits understaffed violations instead of breaking constraints', () => {
    // 3 staff cannot fill 2+2 daily slots plus rest rules
    const input = baseInput({ staff: makeStaff(3) })
    const result = generateSchedule(input)
    expect(result.violations.some((v) => v.rule === 'understaffed')).toBe(true)
    const errors = validateAssignments(input, result.assignments)
      .filter((v) => v.severity === 'error' && v.rule !== 'understaffed')
    expect(errors).toEqual([])
  })
})
