import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { requireEnv } from '@/lib/supabase/env'

const LINE_API = 'https://api.line.me'
const LINE_VERIFY_API = 'https://api.line.me/oauth2/v2.1/verify'

export type LineMessage = Record<string, unknown>

export class LineApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
  }
}

function channelId() {
  return process.env.LINE_MINI_APP_CHANNEL_ID || requireEnv('LINE_CHANNEL_ID')
}

function accessToken() {
  return requireEnv('LINE_CHANNEL_ACCESS_TOKEN')
}

function channelSecret() {
  return requireEnv('LINE_CHANNEL_SECRET')
}

async function readJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

async function lineRequest(path: string, init: RequestInit = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(`${LINE_API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken()}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })
    const body = await readJson(response)
    if (!response.ok) {
      const detail = typeof body.message === 'string' ? body.message : 'LINE API request failed'
      const code = typeof body.error === 'string' ? body.error : undefined
      throw new LineApiError(detail, response.status, code)
    }
    return body
  } catch (error) {
    if (error instanceof LineApiError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LineApiError('LINE API timeout', 504, 'timeout')
    }
    throw new LineApiError('LINE API unavailable', 503, 'unavailable')
  } finally {
    clearTimeout(timeout)
  }
}

/** Verify the exact raw webhook body against x-line-signature. */
export function verifyLineWebhookSignature(rawBody: string, signature: string | null) {
  if (!signature) return false
  const expected = createHmac('sha256', channelSecret()).update(rawBody, 'utf8').digest('base64')
  const received = Buffer.from(signature, 'utf8')
  const actual = Buffer.from(expected, 'utf8')
  return received.length === actual.length && timingSafeEqual(received, actual)
}

export type VerifiedLineIdentity = {
  sub: string
  expiresAt: number
  name?: string
  picture?: string
}

/** Verify a MINI App/LIFF ID token using LINE's token verification endpoint. */
export async function verifyLineIdToken(idToken: string): Promise<VerifiedLineIdentity> {
  if (!idToken || idToken.length > 8_000) throw new LineApiError('Invalid LINE ID token', 401, 'invalid_token')
  let clientId: string
  try {
    clientId = channelId()
  } catch {
    throw new LineApiError('LINE identity verification is not configured', 503, 'not_configured')
  }
  const body = new URLSearchParams({ id_token: idToken, client_id: clientId })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(LINE_VERIFY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
      cache: 'no-store',
    })
    const result = await readJson(response)
    if (!response.ok || typeof result.sub !== 'string' || typeof result.exp !== 'number') {
      throw new LineApiError('Invalid LINE ID token', 401, 'invalid_token')
    }
    const issuer = typeof result.iss === 'string' ? result.iss : ''
    const audience = typeof result.aud === 'string' ? result.aud : ''
    if (issuer !== 'https://access.line.me' || audience !== clientId || !/^U[0-9a-f]{32}$/i.test(result.sub)) {
      throw new LineApiError('Invalid LINE ID token issuer', 401, 'invalid_token')
    }
    if (result.exp * 1000 <= Date.now()) throw new LineApiError('LINE ID token expired', 401, 'expired_token')
    return {
      sub: result.sub,
      expiresAt: result.exp * 1000,
      name: typeof result.name === 'string' ? result.name : undefined,
      picture: typeof result.picture === 'string' ? result.picture : undefined,
    }
  } catch (error) {
    if (error instanceof LineApiError) throw error
    throw new LineApiError('LINE identity verification unavailable', 503, 'verify_unavailable')
  } finally {
    clearTimeout(timeout)
  }
}

export async function issueLineLinkToken(lineUserId: string) {
  if (!/^U[0-9a-f]{32}$/i.test(lineUserId)) throw new LineApiError('Invalid LINE user ID', 400, 'invalid_user')
  const result = await lineRequest(`/v2/bot/user/${encodeURIComponent(lineUserId)}/linkToken`, { method: 'POST' })
  if (typeof result.linkToken !== 'string') throw new LineApiError('LINE did not return a link token', 502, 'bad_response')
  return result.linkToken
}

export async function pushLineMessage(to: string, messages: LineMessage[]) {
  if (!to || messages.length === 0) return
  return lineRequest('/v2/bot/message/push', {
    method: 'POST',
    body: JSON.stringify({ to, messages }),
  })
}

export async function replyLineMessage(replyToken: string, messages: LineMessage[]) {
  if (!replyToken || messages.length === 0) return
  return lineRequest('/v2/bot/message/reply', {
    method: 'POST',
    body: JSON.stringify({ replyToken, messages }),
  })
}

export function accountLinkUrl(linkToken: string, nonce: string) {
  return `https://access.line.me/dialog/bot/accountLink?linkToken=${encodeURIComponent(linkToken)}&nonce=${encodeURIComponent(nonce)}`
}

export function lineAppUrl(path = '/line') {
  const base = requireEnv('LINE_APP_BASE_URL').replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function redactLineError(error: unknown) {
  if (error instanceof LineApiError) return `${error.code ?? 'line_error'}:${error.status}`
  return 'line_error'
}
