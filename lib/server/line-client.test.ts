import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { verifyLineWebhookSignature } from '@/lib/server/line-client'

describe('LINE webhook signature verification', () => {
  const previousSecret = process.env.LINE_CHANNEL_SECRET

  beforeEach(() => {
    process.env.LINE_CHANNEL_SECRET = 'test-channel-secret'
  })

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.LINE_CHANNEL_SECRET
    else process.env.LINE_CHANNEL_SECRET = previousSecret
  })

  it('accepts the HMAC-SHA256 signature for the exact raw body', () => {
    const body = '{"events":[{"type":"follow"}]}'
    const signature = createHmac('sha256', 'test-channel-secret').update(body, 'utf8').digest('base64')
    expect(verifyLineWebhookSignature(body, signature)).toBe(true)
  })

  it('rejects a missing, altered, or differently encoded signature', () => {
    const body = '{"events":[]}'
    const signature = createHmac('sha256', 'test-channel-secret').update(body, 'utf8').digest('base64')
    expect(verifyLineWebhookSignature(body, null)).toBe(false)
    expect(verifyLineWebhookSignature(`${body} `, signature)).toBe(false)
    expect(verifyLineWebhookSignature(body, `${signature}x`)).toBe(false)
  })
})
