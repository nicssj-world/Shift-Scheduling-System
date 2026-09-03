import { bangkokDateString } from '@/lib/dates'
import { getLineSettings } from '@/lib/server/line-config'
import { sendQueuedLineMessages } from '@/lib/server/line-notify'
import { queueGroupRosters } from '@/lib/server/line-scheduled'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const settings = await getLineSettings()
    if (!settings.enabled || !settings.dailyRosterEnabled) return Response.json({ ok: true, groups: 0 })
    const groups = await queueGroupRosters(bangkokDateString(), settings.showPhoneInDailyRoster)
    const sent = await sendQueuedLineMessages(100)
    return Response.json({ ok: true, groups, sent })
  } catch (error) {
    console.error('LINE daily roster failed', error instanceof Error ? error.name : 'unknown')
    return Response.json({ error: 'LINE daily roster failed' }, { status: 500 })
  }
}
