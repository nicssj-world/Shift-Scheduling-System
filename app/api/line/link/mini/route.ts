import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { linkVerifiedMiniAppAccount } from '@/lib/server/line-accounts'
import { LineApiError, verifyLineIdToken } from '@/lib/server/line-client'
import { createLineSession } from '@/lib/server/line-session'
import { HttpError } from '@/lib/server/errors'
import { readJson, respond } from '@/lib/server/route'
import { writeLineAudit } from '@/lib/server/line-audit'

const schema = z.object({ idToken: z.string().min(20).max(8_000) })

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const { idToken } = await readJson(request, schema)
    let identity: Awaited<ReturnType<typeof verifyLineIdToken>>
    try {
      identity = await verifyLineIdToken(idToken)
    } catch (error) {
      if (error instanceof LineApiError && error.status < 500) throw new HttpError(401, 'LINE ID token ไม่ถูกต้องหรือหมดอายุ')
      throw error
    }
    const account = await linkVerifiedMiniAppAccount(identity.sub, actor.id)
    await writeLineAudit({ actorUserId: actor.id, source: 'line', action: 'account_link', referenceType: 'line_account', referenceId: String(account.id) })
    const session = await createLineSession({
      accountId: String(account.id), userId: actor.id, lineUserId: identity.sub,
    })
    return { ok: true, actor, ...session }
  })
}
