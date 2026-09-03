import { z } from 'zod'
import { requireActor } from '@/lib/server/auth'
import { createAccountLinkNonce } from '@/lib/server/line-accounts'
import { accountLinkUrl, lineAppUrl } from '@/lib/server/line-client'
import { readJson, respond } from '@/lib/server/route'

const schema = z.object({ linkToken: z.string().min(16).max(256) })

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const { linkToken } = await readJson(request, schema)
    const nonce = await createAccountLinkNonce(actor.id, linkToken)
    return { redirectUrl: accountLinkUrl(linkToken, nonce), completeUrl: lineAppUrl('/line') }
  })
}
