import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { parseOptionMonth } from '@/lib/server/pagination'

describe('parseOptionMonth', () => {
  it('accepts one explicit roster month', () => {
    expect(parseOptionMonth(new URL('https://example.test/api/options?month=2026-07'))).toBe('2026-07')
  })

  it.each([
    'https://example.test/api/options',
    'https://example.test/api/options?month=2026-7',
    'https://example.test/api/options?month=2026-13',
    'https://example.test/api/options?month=all',
  ])('rejects missing or malformed month: %s', (url) => {
    expect(() => parseOptionMonth(new URL(url))).toThrow('กรุณาระบุเดือนในรูปแบบ YYYY-MM')
  })
})
