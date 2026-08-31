import { describe, expect, it } from 'vitest'
import { normalizeShiftTimes } from '@/lib/scheduler/shift-time'

describe('normalizeShiftTimes', () => {
  it('normalizes an end-of-day 00:00 marker to 24:00', () => {
    expect(normalizeShiftTimes('16:00', '00:00', 8)).toEqual({ startMin: 960, endMin: 1440, hours: 8 })
  })

  it('rejects unsupported overnight intervals and mismatched hours', () => {
    expect(() => normalizeShiftTimes('20:00', '08:00', 12)).toThrow()
    expect(() => normalizeShiftTimes('08:00', '16:00', 7)).toThrow()
    expect(() => normalizeShiftTimes('08:00:30', '16:00', 8)).toThrow()
    expect(() => normalizeShiftTimes('24:00', '24:00', 24)).toThrow()
  })
})
