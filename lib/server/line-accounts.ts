import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { getAdminClient } from '@/lib/supabase/admin'
import { HttpError } from '@/lib/server/errors'
import { revokeAllLineSessions } from '@/lib/server/line-session'

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export async function getLineAccountByLineUserId(lineUserId: string) {
  const { data, error } = await getAdminClient().from('shift_line_accounts')
    .select('id,user_id,line_user_id,status,linked_at,last_seen_at')
    .eq('line_user_id', lineUserId).maybeSingle()
  if (error) throw new HttpError(500, 'อ่านบัญชี LINE ไม่สำเร็จ')
  return data as Record<string, unknown> | null
}

export async function getLineAccountByUserId(userId: string) {
  const { data, error } = await getAdminClient().from('shift_line_accounts')
    .select('id,user_id,line_user_id,status,linked_at,last_seen_at')
    .eq('user_id', userId).maybeSingle()
  if (error) throw new HttpError(500, 'อ่านบัญชี LINE ไม่สำเร็จ')
  return data as Record<string, unknown> | null
}

/** Start the secure Messaging API account-link flow after the user has
 * authenticated with the existing Supabase account. */
export async function createAccountLinkNonce(userId: string, linkToken: string) {
  if (!linkToken || linkToken.length > 256) throw new HttpError(400, 'ลิงก์ LINE ไม่ถูกต้องหรือหมดอายุ')
  const nonce = randomBytes(24).toString('base64url')
  const { error } = await getAdminClient().from('shift_line_account_link_nonces').insert({
    nonce_hash: hash(nonce),
    user_id: userId,
    link_token: linkToken,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  if (error) throw new HttpError(409, 'สร้างคำขอเชื่อมบัญชีไม่สำเร็จ กรุณาขอลิงก์ใหม่')
  return nonce
}

/** Complete account linking inside a single database function so competing
 * link requests cannot attach one LINE identity to two profiles. */
export async function completeAccountLink(lineUserId: string, nonce: string) {
  const { data, error } = await getAdminClient().rpc('shift_link_line_account', {
    p_line_user_id: lineUserId,
    p_nonce_hash: hash(nonce),
  })
  if (error) {
    if (error.code === 'P0001') throw new HttpError(409, error.message)
    if (error.code === '23505') throw new HttpError(409, 'LINE บัญชีนี้ถูกเชื่อมกับผู้ใช้อื่นแล้ว')
    throw new HttpError(500, 'เชื่อมบัญชี LINE ไม่สำเร็จ')
  }
  const row = (Array.isArray(data) ? data[0] : data) as { account_id?: string; user_id?: string } | null
  if (!row?.account_id || !row.user_id) throw new HttpError(409, 'คำขอเชื่อมบัญชีหมดอายุหรือถูกใช้ไปแล้ว')
  await revokeAllLineSessions(String(row.user_id))
  return row
}

/** Link from a verified MINI App ID token while the user is authenticated in
 * the existing Web account. This still never trusts a browser-supplied LINE
 * user ID; the caller must pass the verified token subject. */
export async function linkVerifiedMiniAppAccount(lineUserId: string, userId: string) {
  const admin = getAdminClient()
  const [{ data: byLine, error: lineError }, { data: byUser, error: userError }] = await Promise.all([
    admin.from('shift_line_accounts').select('id,user_id,status').eq('line_user_id', lineUserId).maybeSingle(),
    admin.from('shift_line_accounts').select('id,line_user_id,status').eq('user_id', userId).maybeSingle(),
  ])
  if (lineError || userError) throw new HttpError(500, 'อ่านบัญชี LINE ไม่สำเร็จ')
  if (byLine && String(byLine.user_id) !== userId) throw new HttpError(409, 'LINE บัญชีนี้เชื่อมกับบุคลากรคนอื่นแล้ว')
  if (byUser && String(byUser.line_user_id) !== lineUserId) throw new HttpError(409, 'บัญชีระบบนี้เชื่อมกับ LINE อื่นอยู่แล้ว')

  const payload = {
    user_id: userId,
    line_user_id: lineUserId,
    status: 'active',
    linked_at: new Date().toISOString(),
    unlinked_at: null,
    last_seen_at: new Date().toISOString(),
  }
  const { data, error } = await admin.from('shift_line_accounts')
    .upsert(payload, { onConflict: 'user_id' })
    .select('id,user_id,line_user_id,status,linked_at')
    .single()
  if (error || !data) {
    if (error?.code === '23505') throw new HttpError(409, 'LINE บัญชีนี้ถูกเชื่อมกับผู้ใช้อื่นแล้ว')
    throw new HttpError(500, 'บันทึกบัญชี LINE ไม่สำเร็จ')
  }
  await revokeAllLineSessions(userId)
  return data as Record<string, unknown>
}

export async function unlinkLineAccount(userId: string) {
  const { data, error } = await getAdminClient().from('shift_line_accounts')
    .update({ status: 'disabled', unlinked_at: new Date().toISOString() })
    .eq('user_id', userId).select('id').maybeSingle()
  if (error) throw new HttpError(500, 'ยกเลิกการเชื่อมบัญชีไม่สำเร็จ')
  await revokeAllLineSessions(userId)
  return Boolean(data)
}
