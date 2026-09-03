import { z } from 'zod'
import { getLineAccountByLineUserId } from '@/lib/server/line-accounts'
import { getLineSettings } from '@/lib/server/line-config'
import { LineApiError, verifyLineIdToken } from '@/lib/server/line-client'
import { createLineSession, getLineSession, revokeLineSession } from '@/lib/server/line-session'
import { HttpError } from '@/lib/server/errors'
import { getActorForUserId } from '@/lib/server/auth'
import { readJson, respond } from '@/lib/server/route'

const tokenSchema = z.object({ idToken: z.string().min(20).max(8_000) })

export async function GET() {
  return respond(async () => {
    const session = await getLineSession()
    if (!session) throw new HttpError(401, 'ยังไม่ได้เข้าสู่ LINE MINI App')
    return { actor: session.actor, csrfToken: null, expiresAt: session.row.expires_at }
  })
}

export async function POST(request: Request) {
  return respond(async () => {
    const settings = await getLineSettings()
    if (!settings.enabled) throw new HttpError(503, 'LINE Integration ยังไม่เปิดใช้งาน')
    const { idToken } = await readJson(request, tokenSchema)
    let identity: Awaited<ReturnType<typeof verifyLineIdToken>>
    try {
      identity = await verifyLineIdToken(idToken)
    } catch (error) {
      if (error instanceof LineApiError && error.status < 500) throw new HttpError(401, 'LINE ID token ไม่ถูกต้องหรือหมดอายุ')
      throw error
    }
    const account = await getLineAccountByLineUserId(identity.sub)
    if (!account || String(account.status) !== 'active') throw new HttpError(403, 'ยังไม่ได้เชื่อมบัญชี LINE กับระบบตารางเวร')
    const actor = await getActorForUserId(String(account.user_id))
    if (!actor) throw new HttpError(403, 'บัญชีระบบไม่พร้อมใช้งาน')
    const session = await createLineSession({
      accountId: String(account.id), userId: String(account.user_id), lineUserId: identity.sub,
    })
    return { actor, ...session }
  })
}

export async function DELETE() {
  return respond(async () => {
    await revokeLineSession()
    return { ok: true }
  })
}
