import { describe, expect, it } from 'vitest'
import { newOwnerChangeViolations, type OwnedAssignmentDraft } from '@/lib/scheduler/assignment-changes'
import { makeDays, makeSlots } from '@/lib/scheduler/fixtures'
import { DEFAULT_CONFIG, EMPTY_CARRY_IN } from '@/lib/scheduler/types'

const ctx = {
  days: makeDays('2026-08'),
  slots: makeSlots(0),
  unavailable: {},
  config: DEFAULT_CONFIG,
  carryIn: EMPTY_CARRY_IN,
}

function assignment(id: string, date: string, code: 'A' | 'N', userId: string): OwnedAssignmentDraft {
  return { id, date, code, userId, shiftTypeId: code === 'A' ? 'st-a' : 'st-n', jobId: null }
}

describe('newOwnerChangeViolations', () => {
  it('blocks a sale that creates Sunday A + Monday N + regular Monday work', () => {
    const assignments = [
      assignment('sale', '2026-08-09', 'A', 'seller'),
      assignment('existing', '2026-08-10', 'N', 'buyer'),
    ]
    const violations = newOwnerChangeViolations(ctx, assignments, new Map([['sale', 'buyer']]))
    expect(violations.some((violation) => violation.rule === 'max_consecutive_hours')).toBe(true)
  })

  it('allows a safe one-way transfer', () => {
    const assignments = [assignment('sale', '2026-08-08', 'A', 'seller')]
    expect(newOwnerChangeViolations(ctx, assignments, new Map([['sale', 'buyer']]))).toEqual([])
  })

  it('does not block a transfer because of an unchanged pre-existing violation', () => {
    const assignments = [
      assignment('bad-a', '2026-08-03', 'A', 'other'),
      assignment('bad-n', '2026-08-04', 'N', 'other'),
      assignment('sale', '2026-08-08', 'A', 'seller'),
    ]
    expect(newOwnerChangeViolations(ctx, assignments, new Map([['sale', 'buyer']]))).toEqual([])
  })
})
