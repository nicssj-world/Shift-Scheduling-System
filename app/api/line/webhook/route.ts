import { createHash } from 'node:crypto'
import { getActorForUserId } from '@/lib/server/auth'
import { completeAccountLink, getLineAccountByLineUserId } from '@/lib/server/line-accounts'
import { getLineDailyRoster } from '@/lib/server/line-data'
import { getLineSettings } from '@/lib/server/line-config'
import { issueLineLinkToken, lineAppUrl, pushLineMessage, replyLineMessage, verifyLineWebhookSignature } from '@/lib/server/line-client'
import { writeLineAudit } from '@/lib/server/line-audit'
import { transitionSale, transitionSwap } from '@/lib/server/line-mutations'
import { revokeAllLineSessions } from '@/lib/server/line-session'
import { HttpError } from '@/lib/server/errors'
import { getAdminClient } from '@/lib/supabase/admin'

type LineEvent = {
  type?: string
  webhookEventId?: string
  replyToken?: string
  timestamp?: number
  mode?: string
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string }
  message?: { type?: string; text?: string }
  postback?: { data?: string }
  link?: { result?: string; nonce?: string }
}
type LineWebhookBody = { destination?: string; events?: LineEvent[] }

function eventId(raw: string, event: LineEvent, index: number) {
  return event.webhookEventId || createHash('sha256').update(`${raw}\n${index}\n${JSON.stringify(event)}`, 'utf8').digest('hex')
}

function sourceIds(event: LineEvent) {
  return { lineUserId: event.source?.userId ?? null, lineGroupId: event.source?.groupId ?? event.source?.roomId ?? null }
}

async function beginEvent(id: string, event: LineEvent) {
  const admin = getAdminClient()
  const ids = sourceIds(event)
  const payload = {
    webhook_event_id: id,
    event_type: event.type ?? null,
    source_type: event.source?.type ?? null,
    line_user_id: ids.lineUserId,
    line_group_id: ids.lineGroupId,
    payload: event,
    status: 'processing',
    attempts: 1,
    updated_at: new Date().toISOString(),
  }
  const { error } = await admin.from('shift_line_webhook_events').insert(payload)
  if (!error) return true
  if (error.code !== '23505') throw error
  const { data: existingData } = await admin.from('shift_line_webhook_events').select('id,status,attempts,updated_at,created_at').eq('webhook_event_id', id).maybeSingle()
  const existing = existingData as { id: string; status: string; attempts: number | null; updated_at?: string; created_at?: string } | null
  if (!existing || existing.status === 'processed') return false
  if (existing.status === 'processing' && existing.updated_at && Date.now() - new Date(existing.updated_at).getTime() < 5 * 60_000) return false
  let claimQuery = admin.from('shift_line_webhook_events')
    .update({ status: 'processing', attempts: Number(existing.attempts ?? 0) + 1, error_code: null, updated_at: new Date().toISOString() })
    .eq('id', existing.id).eq('status', existing.status)
  if (existing.updated_at) claimQuery = claimQuery.eq('updated_at', existing.updated_at)
  const { data: claimed } = await claimQuery.select('id').maybeSingle()
  return Boolean(claimed)
}

async function finishEvent(id: string, status: 'processed' | 'failed', errorCode?: string) {
  await getAdminClient().from('shift_line_webhook_events').update({ status, error_code: errorCode ?? null, processed_at: status === 'processed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('webhook_event_id', id)
}

async function touchAccount(lineUserId: string | null) {
  if (!lineUserId) return
  await getAdminClient().from('shift_line_accounts').update({ last_seen_at: new Date().toISOString() }).eq('line_user_id', lineUserId).eq('status', 'active')
}

async function groupPhonePermission(event: LineEvent) {
  const { lineGroupId } = sourceIds(event)
  if (!lineGroupId || !['group', 'room'].includes(event.source?.type ?? '')) return false
  const { data } = await getAdminClient().from('shift_line_groups')
    .select('is_active,is_approved,show_phone_in_daily_roster')
    .eq('line_group_id', lineGroupId).maybeSingle()
  return data?.is_active === true && data?.is_approved === true && data?.show_phone_in_daily_roster === true
}

async function safeReply(event: LineEvent, text: string) {
  if (!text) return
  try {
    if (event.replyToken) await replyLineMessage(event.replyToken, [{ type: 'text', text: text.slice(0, 4_900) }])
    else if (event.source?.userId) await pushLineMessage(event.source.userId, [{ type: 'text', text: text.slice(0, 4_900) }])
  } catch (error) {
    console.error('LINE message delivery failed', error instanceof Error ? error.name : 'unknown')
  }
}

function postbackParams(data: string) {
  if (data.includes('=')) {
    const query = new URLSearchParams(data)
    const queryAction = query.get('action')?.trim().toLowerCase()
    if (queryAction) return { action: queryAction, id: query.get('id')?.trim() ?? '' }
  }
  const [action, id] = data.split(':', 2)
  return { action: action?.trim().toLowerCase() ?? '', id: id?.trim() ?? '' }
}

async function handlePostback(event: LineEvent, lineUserId: string) {
  const data = event.postback?.data?.trim() ?? ''
  const { action, id } = postbackParams(data)
  const account = await getLineAccountByLineUserId(lineUserId)
  if (!account || String(account.status) !== 'active') { await safeReply(event, 'กรุณาเชื่อมบัญชีตารางเวรก่อนใช้งาน'); return }
  const actor = await getActorForUserId(String(account.user_id))
  if (!actor) { await safeReply(event, 'บัญชีระบบยังไม่พร้อมใช้งาน'); return }
  try {
    if (['swap_accept', 'swap_decline', 'swap_approve', 'swap_reject', 'swap_cancel'].includes(action)) {
      const settings = await getLineSettings()
      if (!settings.enabled || !settings.swapEnabled) { await safeReply(event, 'การแลกเวรผ่าน LINE ยังไม่เปิดใช้งาน'); return }
      const result = await transitionSwap(actor, id, action.replace('swap_', '') as 'accept' | 'decline' | 'approve' | 'reject' | 'cancel')
      await writeLineAudit({ actorUserId: actor.id, source: 'line', action, referenceType: 'shift_swap_request', referenceId: id, newValue: result })
      await safeReply(event, 'ดำเนินการคำขอแลกเวรแล้ว ตรวจสอบสถานะล่าสุดใน MINI App ได้เลย')
      return
    }
    if (['sale_accept', 'sale_decline', 'sale_approve', 'sale_reject', 'sale_cancel', 'sale_claim'].includes(action)) {
      const settings = await getLineSettings()
      if (!settings.enabled || !settings.saleEnabled || (action === 'sale_claim' && !settings.openSaleEnabled)) { await safeReply(event, 'การขายเวรผ่าน LINE ยังไม่เปิดใช้งาน'); return }
      const result = await transitionSale(actor, id, action.replace('sale_', '') as 'accept' | 'decline' | 'approve' | 'reject' | 'cancel' | 'claim', 'line')
      await writeLineAudit({ actorUserId: actor.id, source: 'line', action, referenceType: 'shift_sale_request', referenceId: id, newValue: result })
      await safeReply(event, action === 'sale_claim' ? 'รับเวรสำเร็จ ระบบจะอัปเดตตารางตามขั้นตอนอนุมัติ' : 'ดำเนินการคำขอขายเวรแล้ว ตรวจสอบสถานะล่าสุดใน MINI App ได้เลย')
      return
    }
    if (action === 'daily_roster' || action === 'roster') {
      const settings = await getLineSettings()
      if (!settings.enabled || !settings.dailyRosterEnabled) { await safeReply(event, 'ผู้ดูแลระบบยังไม่เปิดสรุปเวรรายวัน'); return }
      const includePhone = settings.showPhoneInDailyRoster && await groupPhonePermission(event)
      const roster = await getLineDailyRoster(actor, /^\d{4}-\d{2}-\d{2}$/.test(id) ? id : undefined, includePhone)
      const lines = [`เวรประจำวันที่ ${roster.date}`, ...roster.teams.flatMap((team) => [team.teamName, ...team.shifts.map((shift) => `${shift.code} ${shift.typeName} · ${shift.userName}${shift.phone ? ` · ${shift.phone}` : ''}`)])]
      await safeReply(event, lines.join('\n'))
      return
    }
    await safeReply(event, 'เปิด MINI App เพื่อดูเมนูและสถานะล่าสุดของคุณ')
  } catch (error) {
    await safeReply(event, error instanceof HttpError && error.status < 500 ? error.message : 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่')
  }
}

async function handleEvent(event: LineEvent) {
  const { lineUserId, lineGroupId } = sourceIds(event)
  await touchAccount(lineUserId)
  if (event.type === 'accountLink') {
    if (event.link?.result === 'ok' && lineUserId && event.link.nonce) {
      const linked = await completeAccountLink(lineUserId, event.link.nonce)
      await writeLineAudit({ actorUserId: String(linked.user_id), source: 'line', action: 'account_link', referenceType: 'line_account', referenceId: String(linked.account_id) })
      await safeReply(event, 'เชื่อมบัญชีสำเร็จ เปิด MINI App เพื่อดูตารางเวรได้เลย')
    } else await writeLineAudit({ source: 'line', action: 'account_link_failed', referenceType: 'line_user', referenceId: lineUserId })
    return
  }
  if (event.type === 'join' && lineGroupId) {
    await getAdminClient().from('shift_line_groups').upsert({ line_group_id: lineGroupId, group_type: event.source?.type === 'room' ? 'room' : 'group', is_active: false, is_approved: false }, { onConflict: 'line_group_id' })
    await writeLineAudit({ source: 'line', action: 'group_join', referenceType: 'line_group', referenceId: lineGroupId })
    await safeReply(event, 'เพิ่มกลุ่มแล้ว รอผู้ดูแลระบบอนุมัติก่อนรับข้อความตารางเวร')
    return
  }
  if (event.type === 'leave' && lineGroupId) {
    await getAdminClient().from('shift_line_groups').update({ is_active: false }).eq('line_group_id', lineGroupId)
    await writeLineAudit({ source: 'line', action: 'group_leave', referenceType: 'line_group', referenceId: lineGroupId })
    return
  }
  if (event.type === 'unfollow' && lineUserId) {
    await getAdminClient().from('shift_line_accounts').update({ status: 'blocked', unlinked_at: new Date().toISOString() }).eq('line_user_id', lineUserId)
    const account = await getLineAccountByLineUserId(lineUserId)
    if (account?.user_id) await revokeAllLineSessions(String(account.user_id))
    await writeLineAudit({ source: 'line', action: 'account_blocked', referenceType: 'line_user', referenceId: lineUserId })
    return
  }
  if (event.type === 'follow' && lineUserId) {
    await getAdminClient().from('shift_line_accounts').update({ last_seen_at: new Date().toISOString() }).eq('line_user_id', lineUserId).eq('status', 'active')
    await safeReply(event, 'ยินดีต้อนรับสู่ระบบตารางเวร พิมพ์ “เชื่อมบัญชี” เพื่อเริ่มใช้งาน')
    return
  }
  if (event.type === 'message' && event.message?.type === 'text' && lineUserId) {
    const text = event.message.text?.trim().toLowerCase() ?? ''
    if (text.includes('เชื่อมบัญชี') || text === 'link' || text === 'connect') {
      const linkToken = await issueLineLinkToken(lineUserId)
      const url = `${lineAppUrl('/line/link')}?linkToken=${encodeURIComponent(linkToken)}`
      try { if (event.replyToken) await replyLineMessage(event.replyToken, [{ type: 'template', altText: 'เชื่อมบัญชีระบบตารางเวร', template: { type: 'buttons', text: 'เชื่อม LINE กับบัญชีระบบตารางเวร', actions: [{ type: 'uri', label: 'เชื่อมบัญชี', uri: url }] } }]) } catch (error) { console.error('LINE link message failed', error instanceof Error ? error.name : 'unknown') }
    } else await safeReply(event, 'พิมพ์ “เชื่อมบัญชี” เพื่อเริ่มเชื่อมบัญชี หรือเปิดเมนู MINI App')
    return
  }
  if (event.type === 'postback' && lineUserId) await handlePostback(event, lineUserId)
}

export async function POST(request: Request) {
  const raw = await request.text()
  if (raw.length > 512_000) return Response.json({ error: 'Webhook payload too large' }, { status: 413 })
  try {
    if (!verifyLineWebhookSignature(raw, request.headers.get('x-line-signature'))) return Response.json({ error: 'Invalid signature' }, { status: 401 })
  } catch { return Response.json({ error: 'Webhook is not configured' }, { status: 503 }) }
  let body: LineWebhookBody
  try { body = JSON.parse(raw) as LineWebhookBody } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const events = Array.isArray(body.events) ? body.events : []
  if (events.length > 100) return Response.json({ error: 'Too many webhook events' }, { status: 413 })
  try {
    for (const [index, event] of events.entries()) {
      const id = eventId(raw, event, index)
      if (!await beginEvent(id, event)) continue
      try {
        await handleEvent(event)
        await finishEvent(id, 'processed')
      } catch (error) {
        // Invalid postback/account-link state is a handled business error;
        // acknowledge it so LINE does not retry the same event forever.
        if (error instanceof HttpError && error.status < 500) {
          await finishEvent(id, 'processed', error.name)
          await safeReply(event, error.message)
          continue
        }
        await finishEvent(id, 'failed', error instanceof Error ? error.name : 'handler_error')
        throw error
      }
    }
  } catch (error) { console.error('LINE webhook processing failed', error instanceof Error ? error.name : 'unknown'); return Response.json({ error: 'Webhook processing failed' }, { status: 500 }) }
  return Response.json({ ok: true })
}
