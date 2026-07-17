import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  inFilter: vi.fn(),
  finalOrder: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mocks.from }),
}))

import { getRequestEvents } from '@/lib/server/request-events'

describe('getRequestEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalOrder.mockResolvedValue({ data: [], error: null })
    mocks.inFilter.mockImplementation(() => ({
      order: () => ({ order: mocks.finalOrder }),
    }))
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({ in: mocks.inFilter }),
      }),
    })
  })

  it('chunks a large actionable queue instead of creating an oversized PostgREST URL', async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `request-${index}`)

    await getRequestEvents('swap', ids)

    expect(mocks.inFilter).toHaveBeenCalledTimes(3)
    expect(mocks.inFilter.mock.calls.map((call) => call[1].length)).toEqual([50, 50, 20])
  })
})
