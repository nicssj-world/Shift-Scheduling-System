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
        totalCounts: {},
      },
    })
    const result = generateSchedule(input)
    // u01 worked A on 31 Jul → cannot take N on 1 Aug (contiguous double, toggle off)
    const bad = result.assignments.filter((a) => a.userId === 'u01' && a.date === '2026-08-01' && a.code === 'N')
    expect(bad).toEqual([])
  })

  it('deprioritizes whoever already has more lifetime shifts carried in from prior months', () => {
    // Same scenario the user described: last month one person ended up with
    // an extra shift versus everyone else. This month, carry-in totals
    // should make the scheduler favor catching everyone else up rather than
    // giving the same person the "extra" shift again.
    const staff = makeStaff(6)
    const totalCounts = Object.fromEntries(staff.map((s) => [s.userId, 9]))
    totalCounts['u01'] = 10 // u01 was the "extra" person last month
    const slot = {
      shiftTypeId: 'st-a', code: 'A', startMin: 960, endMin: 1440, hours: 8,
      requiredByDayClass: { weekday: 5, weekend: 5, holiday: 5 } as const, // 5 of 6 picked daily
    }
    const input = baseInput({
      staff, slots: [slot], days: makeDays('2026-08'),
      carryIn: { assignments: {}, shiftTypeCounts: {}, jobCounts: {}, totalCounts },
    })
    const result = generateSchedule(input)

    // u01 entered the month already ahead — the fix should give them the
    // FEWEST new shifts this month (ideally none, to let the others catch up).
    const u01Total = result.stats['u01'].total
    const othersMin = Math.min(...staff.filter((s) => s.userId !== 'u01').map((s) => result.stats[s.userId].total))
    expect(u01Total).toBeLessThanOrEqual(othersMin)
  })

  it('rotates the four jobs evenly', () => {
    const slots = makeSlots(4).filter((s) => s.code === 'A')
    const input = baseInput({ slots, staff: makeStaff(8), jobs: FOUR_JOBS })
    const result = generateSchedule(input)

    for (const [, stats] of Object.entries(result.stats)) {
      const counts = FOUR_JOBS.map((j) => stats.byJob[j.code] ?? 0)
      // Slightly looser than per-person job counts alone would need, because
      // the date-varying tiebreak (see tieBreakHash) deliberately mixes up
      // who gets picked together each day to avoid repeat-pairing cliques —
      // that healthy people-level variety trades off a little job-level
      // smoothness within a single month (it still averages out over time
      // via carry-in).
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(3)
    }
    // every assignment got a job
    expect(result.assignments.every((a) => a.jobId !== null)).toBe(true)
  })

  it('spreads out who works together instead of locking the same pair in repeatedly', () => {
    // Single 2-person slot, 10 staff — many equally-fair candidates every
    // time totals tie, so the only thing that can stop the same duo from
    // being reselected forever is penalizing repeat pairings.
    const slot = {
      shiftTypeId: 'st-a', code: 'A', startMin: 960, endMin: 1440, hours: 8,
      requiredByDayClass: { weekday: 2, weekend: 2, holiday: 2 } as const,
    }
    const input = baseInput({ staff: makeStaff(10), slots: [slot], days: makeDays('2026-08') })
    const result = generateSchedule(input)

    const byDay = new Map<string, string[]>()
    for (const a of result.assignments) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a.userId])

    const pairCounts = new Map<string, number>()
    for (const group of byDay.values()) {
      if (group.length !== 2) continue
      const key = [...group].sort().join('|')
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
    }

    // 45 possible pairs among 10 people, ~31 day-slots filled — a healthy
    // spread keeps any single pair rare; without pairing-awareness the same
    // duo reappears every time everyone's individual totals tie again.
    expect(Math.max(...pairCounts.values())).toBeLessThanOrEqual(2)
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
