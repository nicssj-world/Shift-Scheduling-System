import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { parseInitialAssignments } from '@/lib/server/data'

describe('parseInitialAssignments', () => {
  it('keeps an empty snapshot as a real empty baseline instead of falling back', () => {
    expect(parseInitialAssignments({ id: 'schedule-1', initial_assignments: [] })).toEqual([])
    expect(parseInitialAssignments({ id: 'schedule-1' })).toBeNull()
  })

  it('normalizes snapshot rows to the assignment-table shape', () => {
    expect(parseInitialAssignments({
      id: 'schedule-1',
      initial_assignments: [{
        work_date: '2026-09-30',
        shift_type_id: 'shift-1',
        user_id: 'user-1',
        job_id: 'job-1',
      }],
    })).toEqual([{
      schedule_id: 'schedule-1',
      work_date: '2026-09-30',
      shift_type_id: 'shift-1',
      user_id: 'user-1',
      job_id: 'job-1',
    }])
  })
})
