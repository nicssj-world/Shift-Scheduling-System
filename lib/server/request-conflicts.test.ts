import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mocks.from }),
}))

import { getPendingAssignmentIds } from '@/lib/server/request-conflicts'

describe('getPendingAssignmentIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockResolvedValue({
      data: [{ assignment_id: 'a-1' }, { assignment_id: 'a-2' }, { assignment_id: 'a-3' }],
      error: null,
    })
    mocks.from.mockReturnValue({ select: mocks.select })
  })

  it('does not put a large candidate-assignment list into the PostgREST URL', async () => {
    const assignmentIds = ['a-1', 'a-2', 'a-3', ...Array.from({ length: 500 }, (_, index) => `other-${index}`)]

    const blocked = await getPendingAssignmentIds(assignmentIds)

    expect([...blocked].sort()).toEqual(['a-1', 'a-2', 'a-3'])
    expect(mocks.from).toHaveBeenCalledWith('shift_assignment_reservations')
    expect(mocks.select).toHaveBeenCalledWith('assignment_id')
    expect(JSON.stringify(mocks.select.mock.calls)).not.toContain('other-499')
  })
})
