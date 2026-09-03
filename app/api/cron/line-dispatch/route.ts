import { bangkokDateString, bangkokTomorrowString, thaiShortDate } from '@/lib/dates'
import { getLineSettings } from '@/lib/server/line-config'
import { notifyUsers } from '@/lib/server/notify'
import { sendQueuedLineMessages } from '@/lib/server/line-notify'
import { queueGroupRosters } from '@/lib/server/line-scheduled'
import { getShiftTypes } from '@/lib/server/data'
import { getAdminClient } from '@/lib/supabase/admin'
import { expireOpenSaleListings } from '@/lib/server/open-sales'

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`)
}

async function queuePersonalReminders(date: string) {
  const admin = getAdminClient()
  const { data: schedules } = await admin.from('shift_schedules').select('id').in('status', ['published', 'locked'])
  const ids = (schedules ?? []).map((row) => String(row.id))
  if (ids.length === 0) return 0
  const { data: assignments } = await admin.from('shift_assignments').select('user_id,shift_type_id').eq('work_date', date).in('schedule_id', ids)
  const types = await getShiftTypes()
  const byType = new Map(types.map((type) => [type.id, type]))
  const byUser = new Map<string, string[]>()
  for (const row of assignments ?? []) {
    const type = byType.get(String(row.shift_type_id))
    if (!type) continue
    byUser.set(String(row.user_id), [...(byUser.get(String(row.user_id)) ?? []), `${type.name_th} (${type.start_time.slice(0, 5)}-${type.end_time.slice(0, 5)})`])
  }
  for (const [userId, shifts] of byUser) await notifyUsers([userId], { type: 'shift_reminder', title: `พรุ่งนี้ (${thaiShortDate(date)}) คุณมีเวร`, body: shifts.join(' และ '), link: '/line/my-shifts', dedupeKey: (id) => `reminder:${date}:${id}` })
  return byUser.size
}


export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await expireOpenSaleListings()
    const settings = await getLineSettings()
    const sent = settings.enabled ? await sendQueuedLineMessages(100) : { inspected: 0, sent: 0, failed: 0 }
    const now = new Date()
    const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(now))
    const localMinute = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', minute: '2-digit' }).format(now))
    let reminders = 0
    let groups = 0
    if (settings.enabled && localMinute < 15 && settings.personalReminderEnabled && localHour === settings.personalReminderHour) reminders = await queuePersonalReminders(bangkokTomorrowString())
    if (settings.enabled && localMinute < 15 && settings.dailyRosterEnabled && localHour === settings.dailyRosterHour) groups = await queueGroupRosters(bangkokDateString(), settings.showPhoneInDailyRoster)
    const flushed = (reminders > 0 || groups > 0) && settings.enabled ? await sendQueuedLineMessages(100) : { inspected: 0, sent: 0, failed: 0 }
    return Response.json({ ok: true, sent: { ...sent, flushed }, reminders, groups })
  } catch (error) {
    console.error('LINE dispatcher failed', error instanceof Error ? error.name : 'unknown')
    return Response.json({ error: 'LINE dispatcher failed' }, { status: 500 })
  }
}
