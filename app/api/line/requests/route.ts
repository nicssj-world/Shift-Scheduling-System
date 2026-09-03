import { getLineRequests } from '@/lib/server/line-data'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { respond } from '@/lib/server/route'
import { getLineSettings } from '@/lib/server/line-config'
import { HttpError } from '@/lib/server/errors'

export async function GET() {
  return respond(async () => {
    const actor = await requireLineSessionActor()
    if (!(await getLineSettings()).enabled) throw new HttpError(503, 'LINE Integration ยังไม่เปิดใช้งาน')
    return getLineRequests(actor)
  })
}
