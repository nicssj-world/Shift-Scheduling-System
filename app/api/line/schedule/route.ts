import { getLineSchedule } from '@/lib/server/line-data'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { respond } from '@/lib/server/route'
import { getLineSettings } from '@/lib/server/line-config'
import { HttpError } from '@/lib/server/errors'

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireLineSessionActor()
    if (!(await getLineSettings()).enabled) throw new HttpError(503, 'LINE Integration ยังไม่เปิดใช้งาน')
    const url = new URL(request.url)
    return getLineSchedule(actor, url.searchParams.get('month'), url.searchParams.get('team'))
  })
}
