import { bangkokTomorrowString, thaiShortDate } from '@/lib/dates'
import { getShiftTypes } from '@/lib/server/data'
import { notifyUsers } from '@/lib/server/notify'
import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Vercel cron (daily 09:00 UTC = 16:00 ICT): remind everyone who has a shift
 * tomorrow. Idempotent via dedupe_key — safe to invoke repeatedly.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tomorrow = bangkokTomorrowString()
  const admin = getAdminClient()

  const { data: schedules } = await admin
    .from('shift_schedules').select('id').in('status', ['published', 'locked'])
  const scheduleIds = (schedules ?? []).map((s) => String(s.id))
  if (scheduleIds.length === 0) return Response.json({ ok: true, notified: 0 })

  const { data: assignments, error } = await admin
    .from('shift_assignments')
    .select('user_id,shift_type_id,schedule_id')
    .eq('work_date', tomorrow)
    .in('schedule_id', scheduleIds)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const shiftTypes = await getShiftTypes()
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]))

  const byUser = new Map<string, string[]>()
  for (const a of assignments ?? []) {
    const type = typeById.get(String(a.shift_type_id))
    const list = byUser.get(String(a.user_id)) ?? []
    if (type) list.push(`${type.name_th} (${type.start_time.slice(0, 5)}-${type.end_time.slice(0, 5)})`)
    byUser.set(String(a.user_id), list)
  }

  for (const [userId, shifts] of byUser) {
    await notifyUsers([userId], {
      type: 'shift_reminder',
      title: `พรุ่งนี้ (${thaiShortDate(tomorrow)}) คุณมีเวร`,
      body: shifts.join(' และ '),
      link: '/schedule',
      dedupeKey: (uid) => `reminder:${tomorrow}:${uid}`,
    })
  }

  return Response.json({ ok: true, date: tomorrow, notified: byUser.size })
}
