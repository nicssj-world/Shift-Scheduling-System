import { describe, expect, it, vi } from 'vitest'

import { HttpError } from '@/lib/server/errors'

vi.mock('server-only', () => ({}))

import { throwRequestRpcError } from '@/lib/server/request-rpc'

describe('throwRequestRpcError', () => {
  it('maps a concurrent reservation collision to HTTP 409', () => {
    expect(() => throwRequestRpcError({ code: '23505' }, 'fallback')).toThrowError(
      expect.objectContaining<HttpError>({ status: 409 }),
    )
  })

  it('maps a stale roster version to HTTP 409 without leaking a 500', () => {
    expect(() => throwRequestRpcError({ code: '40001', message: 'ตารางเวรเปลี่ยนแล้ว' }, 'fallback')).toThrowError(
      expect.objectContaining<HttpError>({ status: 409, message: 'ตารางเวรเปลี่ยนแล้ว' }),
    )
  })

  it('keeps unexpected database errors internal', () => {
    expect(() => throwRequestRpcError({ code: 'XX000', message: 'internal detail' }, 'ทำรายการไม่สำเร็จ')).toThrowError(
      expect.objectContaining<HttpError>({ status: 500, message: 'ทำรายการไม่สำเร็จ' }),
    )
  })
})
