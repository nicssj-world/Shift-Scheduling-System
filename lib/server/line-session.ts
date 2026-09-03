import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { getActorForUserId } from '@/lib/server/auth'
import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'

export const LINE_SESSION_COOKIE = 'shift-line-session'
export const LINE_CSRF_COOKIE = 'shift-line-csrf'
const SESSION_TTL_SECONDS = 8 * 60 * 60

type SessionRow = {
  id: string
  account_id: string
  user_id: string
  line_user_id: string
  csrf_hash: string
  expires_at: string
  revoked_at: string | null
}

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function cookieOptions(httpOnly: boolean) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }
}

export async function createLineSession(input: { accountId: string; userId: string; lineUserId: string }) {
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()
  const admin = getAdminClient()
  await admin.from('shift_line_sessions').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', input.userId).is('revoked_at', null)
  const { error } = await admin.from('shift_line_sessions').insert({
    account_id: input.accountId,
    user_id: input.userId,
    line_user_id: input.lineUserId,
    token_hash: hash(token),
    csrf_hash: hash(csrf),
    expires_at: expiresAt,
  })
  if (error) throw new HttpError(500, 'สร้างเซสชัน LINE ไม่สำเร็จ')

  const store = await cookies()
  store.set(LINE_SESSION_COOKIE, token, cookieOptions(true))
  store.set(LINE_CSRF_COOKIE, csrf, cookieOptions(false))
  return { expiresAt, csrfToken: csrf }
}

export async function getLineSession(): Promise<{ row: SessionRow; actor: NonNullable<Awaited<ReturnType<typeof getActorForUserId>>> } | null> {
  const token = (await cookies()).get(LINE_SESSION_COOKIE)?.value
  if (!token) return null
  const admin = getAdminClient()
  const { data, error } = await admin.from('shift_line_sessions')
    .select('id,account_id,user_id,line_user_id,csrf_hash,expires_at,revoked_at')
    .eq('token_hash', hash(token)).is('revoked_at', null).maybeSingle()
  if (error || !data) return null
  const row = data as unknown as SessionRow
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await admin.from('shift_line_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', row.id)
    return null
  }
  const { data: account } = await admin.from('shift_line_accounts')
    .select('user_id,line_user_id,status').eq('id', row.account_id).maybeSingle()
  if (!account || String(account.user_id) !== row.user_id || String(account.line_user_id) !== row.line_user_id || String(account.status) !== 'active') {
    await admin.from('shift_line_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', row.id)
    return null
  }
  const actor = await getActorForUserId(row.user_id)
  if (!actor) return null
  void admin.from('shift_line_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id)
  return { row, actor }
}

export async function requireLineSessionActor(request?: Request, mutation = false) {
  const session = await getLineSession()
  if (!session) throw new HttpError(401, 'กรุณาเปิด LINE MINI App ใหม่')
  if (mutation && request) await assertLineRequest(request, session.row)
  return session.actor
}

export async function assertLineRequest(request: Request, session: SessionRow) {
  const origin = request.headers.get('origin')
  const configured = process.env.LINE_APP_BASE_URL
  if (origin && configured) {
    try {
      if (new URL(origin).origin !== new URL(configured).origin) throw new HttpError(403, 'คำขอมาจากแหล่งที่ไม่ถูกต้อง')
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(403, 'คำขอมาจากแหล่งที่ไม่ถูกต้อง')
    }
  }
  const token = request.headers.get('x-line-csrf')
  const cookieToken = (await cookies()).get(LINE_CSRF_COOKIE)?.value
  if (!token || !cookieToken || token !== cookieToken || hash(token) !== session.csrf_hash) {
    throw new HttpError(403, 'เซสชันไม่ถูกต้อง กรุณาเปิดหน้าใหม่')
  }
}

export async function revokeLineSession() {
  const token = (await cookies()).get(LINE_SESSION_COOKIE)?.value
  if (token) await getAdminClient().from('shift_line_sessions')
    .update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash(token))
  const store = await cookies()
  store.set(LINE_SESSION_COOKIE, '', { ...cookieOptions(true), maxAge: 0 })
  store.set(LINE_CSRF_COOKIE, '', { ...cookieOptions(false), maxAge: 0 })
}

export async function revokeAllLineSessions(userId: string) {
  await getAdminClient().from('shift_line_sessions').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId).is('revoked_at', null)
}
