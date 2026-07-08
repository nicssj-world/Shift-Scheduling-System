import { requireActor } from '@/lib/server/auth'
import { respond } from '@/lib/server/route'

export async function GET() {
  return respond(async () => {
    const actor = await requireActor()
    return { actor }
  })
}
