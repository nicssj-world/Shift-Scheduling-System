import { requireActor } from '@/lib/server/auth'
import { monthRange } from '@/lib/dates'
import { HttpError } from '@/lib/server/errors'
import { respond } from '@/lib/server/route'
import { getAdminClient } from '@/lib/supabase/admin'
import { leaveDays, type DayPart, type LeaveType } from '@/lib/types'

/** Leave summary rows per person × month × type over a month range (B.E.-agnostic YYYY-MM). */
export async function GET(request: Request) {
  return respond(async () => {
    const actor = await requireActor()
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!from || !to || !/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      throw new HttpError(400, 'ต้องระบุ from/to รูปแบบ YYYY-MM')
    }
    const months = monthRange(from, to)
    if (months.length === 0) throw new HttpError(400, 'ช่วงเดือนไม่ถูกต้อง')

    const canSeeAll = actor.isAdmin || actor.isManager || actor.isScheduler
    const admin = getAdminClient()
    const firstDate = `${months[0]}-01`
    const lastMonthDates = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)).getUTCDate()
    const lastDate = `${to}-${String(lastMonthDates).padStart(2, '0')}`

    let query = admin.from('shift_leaves')
      .select('user_id,leave_type,start_date,end_date,day_part,status')
      .eq('status', 'approved')
      .lte('start_date', lastDate)
      .gte('end_date', firstDate)
    if (!canSeeAll) query = query.eq('user_id', actor.id)
    const { data, error } = await query
    if (error) throw new HttpError(500, error.message)

    const userIds = [...new Set((data ?? []).map((r) => String(r.user_id)))]
    let profileById: Record<string, { name: string; dept: string | null }> = {}
    if (userIds.length > 0) {
      const { data: profiles } = await admin.from('profiles').select('id,name,dept').in('id', userIds)
      profileById = Object.fromEntries((profiles ?? []).map((p) => [
        String(p.id), { name: String(p.name), dept: p.dept ? String(p.dept) : null },
      ]))
    }

    // per user × month × type day counts (split multi-day leaves by month)
    const rows: Record<string, { userId: string; name: string; dept: string | null; month: string; type: LeaveType; days: number }> = {}
    for (const leave of data ?? []) {
      const userId = String(leave.user_id)
      const dayPart = String(leave.day_part) as DayPart
      let cursor = String(leave.start_date)
      const end = String(leave.end_date)
      while (cursor <= end) {
        const month = cursor.slice(0, 7)
        if (months.includes(month)) {
          const key = `${userId}|${month}|${leave.leave_type}`
          const row = (rows[key] ??= {
            userId,
            name: profileById[userId]?.name ?? '',
            dept: profileById[userId]?.dept ?? null,
            month,
            type: String(leave.leave_type) as LeaveType,
            days: 0,
          })
          row.days += dayPart === 'full' ? 1 : 0.5
        }
        const d = new Date(`${cursor}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() + 1)
        cursor = d.toISOString().slice(0, 10)
      }
    }

    return { months, rows: Object.values(rows).sort((a, b) => a.name.localeCompare(b.name) || a.month.localeCompare(b.month)) }
  })
}
