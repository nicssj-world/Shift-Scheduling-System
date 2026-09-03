import { unlinkLineAccount } from '@/lib/server/line-accounts'
import { writeLineAudit } from '@/lib/server/line-audit'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { respond } from '@/lib/server/route'

export async function POST(request: Request) {
  return respond(async () => {
    const actor = await requireLineSessionActor(request, true)
    const changed = await unlinkLineAccount(actor.id)
    await writeLineAudit({ actorUserId: actor.id, source: 'line', action: 'account_unlinked', referenceType: 'profile', referenceId: actor.id })
    return { ok: true, changed }
  })
}
