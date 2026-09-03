import { getLineDailyRoster } from '@/lib/server/line-data'
import { getLineSettings } from '@/lib/server/line-config'
import { requireLineSessionActor } from '@/lib/server/line-session'
import { respond } from '@/lib/server/route'
import { HttpError } from '@/lib/server/errors'

export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireLineSessionActor()
    const settings = await getLineSettings()
    if (!settings.enabled || !settings.dailyRosterEnabled) throw new HttpError(403, 'ผู้ดูแลระบบยังไม่เปิดสรุปเวรรายวัน')
    const date = new URL(request.url).searchParams.get('date') ?? undefined
    // Phone numbers are reserved for approved group broadcasts. The
    // authenticated MINI App roster never exposes them.
    return getLineDailyRoster(actor, date, false)
  })
}
